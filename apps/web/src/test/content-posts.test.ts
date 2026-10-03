import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { postSchema, type Post } from "../lib/content/models";
import {
  createPublishedPostVariants,
  createPreviewPostVariants,
  getPostCover,
  getPostLocalResources,
  type PostSource,
} from "../lib/content/posts";
import { parseRestrictedYaml } from "../lib/content/yaml";

const fixture = parseRestrictedYaml(
  await readFile(new URL("./fixtures/post.yaml", import.meta.url), "utf8"),
  postSchema,
);
const today = "2026-10-02";

function createPost(overrides: Partial<Post> = {}): Post {
  return postSchema.parse({ ...structuredClone(fixture), ...overrides });
}

function source(posts: Post[]): PostSource {
  return { posts, eventIds: new Set(["club-event"]) };
}

describe("post schema", () => {
  it("supports brief news and blogs with personal or organizational bylines", () => {
    expect(createPost({ sections: [] }).sections).toEqual([]);
    expect(
      createPost({
        type: "blog",
        author: { type: "person", name: "Autoria de prova" },
      }).type,
    ).toBe("blog");
    expect(postSchema.safeParse({ ...fixture, type: "blog" }).success).toBe(
      true,
    );
  });

  it.each([
    { published: true },
    { type: "announcement" },
    { createdAt: "2026-02-30" },
    { publishedAt: "2026-10-02T10:00:00" },
    { publishedAt: "2026-10-02T10:00:00+99:99" },
    { publishedAt: "2026-10-01T10:00:00+02:00" },
    { updatedAt: "2026-10-01T10:00:00Z" },
    { updatedAt: "invalid" },
    { lead: { ca: "<script>alert(1)</script>" } },
    { sections: [{ body: { ca: "# Un H1 no permès" } }] },
    { sections: [{ body: { ca: "[Enllaç](javascript:alert)" } }] },
    { sources: [{ name: { ca: "Font" }, url: "http://example.org" }] },
    { author: { type: "person", name: " " } },
    { correction: { date: "2026-02-30", note: { ca: "Correcció" } } },
    { unexpected: true },
  ])(
    "rejects invalid editorial input %j without throwing from refinements",
    (overrides) => {
      expect(postSchema.safeParse({ ...fixture, ...overrides }).success).toBe(
        false,
      );
    },
  );

  it("compares publication and update instants rather than timestamp strings", () => {
    const post = createPost({
      published: true,
      publishedAt: "2026-10-02T10:00:00+02:00",
      updatedAt: "2026-10-02T09:00:00Z",
    });
    expect(post.updatedAt).toBe("2026-10-02T09:00:00Z");
    expect(
      postSchema.safeParse({ ...post, updatedAt: "2026-10-02T07:00:00Z" })
        .success,
    ).toBe(false);
  });

  it("compares preparation with the publication calendar date in Madrid", () => {
    expect(
      createPost({ publishedAt: "2026-10-01T23:00:00Z" }).publishedAt,
    ).toBeDefined();
  });

  it("allows a withdrawn post to keep its historical publication date", () => {
    expect(
      createPost({ publishedAt: "2026-10-02T10:00:00+02:00" }).published,
    ).toBe(false);
  });

  it("requires a local image with translated alt and credit", () => {
    const cover = {
      resource: { kind: "local", path: "src/assets/posts/photo.jpg" },
      alt: { ca: "Imatge de prova" },
      attribution: { ca: "Fotografia de prova" },
    };
    expect(postSchema.safeParse({ ...fixture, cover }).success).toBe(true);
    for (const invalidCover of [
      {
        ...cover,
        resource: { kind: "external", url: "https://example.org/photo.jpg" },
      },
      {
        ...cover,
        resource: { kind: "local", path: "src/assets/../private.jpg" },
      },
      {
        ...cover,
        resource: { kind: "local", path: "src/assets/posts/file.pdf" },
      },
      { ...cover, attribution: undefined },
      { ...cover, alt: { en: "No Catalan alternative" } },
    ]) {
      expect(
        postSchema.safeParse({ ...fixture, cover: invalidCover }).success,
      ).toBe(false);
    }
  });
});

describe("explicit post publication and preview selection", () => {
  it("selects only renderable covers, deduplicating shared and multilingual resources", () => {
    const cover = {
      resource: { kind: "local" as const, path: "src/assets/posts/shared.jpg" },
      alt: { ca: "Foto", es: "Foto" },
      attribution: { ca: "Autoria" },
    };
    const published = createPost({
      published: true,
      publishedAt: "2026-10-02T10:00:00Z",
      cover,
    });
    const draft = createPost({
      id: "draft",
      slug: { ca: "esborrany" },
      cover: {
        ...cover,
        resource: { kind: "local", path: "src/assets/posts/draft.jpg" },
      },
    });
    const shared = createPost({
      id: "shared",
      slug: { ca: "compartit" },
      cover,
    });
    const input = source([published, draft, shared]);
    expect(getPostCover(published, "es")).toBeUndefined();
    expect(getPostCover(createPost(), "ca")).toBeUndefined();
    expect(
      getPostLocalResources(createPublishedPostVariants(input, today)),
    ).toEqual(["src/assets/posts/shared.jpg"]);
    expect(
      getPostLocalResources(createPreviewPostVariants(input, today)),
    ).toEqual(["src/assets/posts/draft.jpg", "src/assets/posts/shared.jpg"]);
    expect(
      getPostLocalResources([
        { kind: "news", locale: "es", slug: "ejemplo", entry: published },
      ]),
    ).toEqual([]);
  });
  it("selects the same draft only in preview without changing its state", () => {
    const draft = createPost();
    const published = createPost({
      id: "published-example",
      slug: { ca: "publicat" },
      published: true,
      publishedAt: "2026-10-02T10:00:00+02:00",
    });
    const input = source([draft, published]);
    expect(
      createPublishedPostVariants(input, today).map(({ entry }) => entry.id),
    ).toEqual([published.id]);
    expect(
      createPreviewPostVariants(input, today).map(({ entry }) => entry.id),
    ).toEqual([published.id, draft.id]);
    expect(draft.published).toBe(false);
  });

  it("excludes a variant when a required translation or a section heading is missing", () => {
    const translated = createPost({
      slug: { ca: "exemple", es: "ejemplo" },
      title: { ca: "Exemple", es: "Ejemplo" },
      summary: { ca: "Resum", es: "Resumen" },
      lead: { ca: "Entradeta", es: "Entrada" },
      sections: [
        { heading: { ca: "Context" }, body: { ca: "Cos", es: "Cuerpo" } },
      ],
    });
    expect(
      createPreviewPostVariants(source([translated]), today).map(
        ({ locale }) => locale,
      ),
    ).toEqual(["ca"]);
    translated.sections[0]!.heading!.es = "Contexto";
    expect(
      createPreviewPostVariants(source([translated]), today).map(
        ({ locale }) => locale,
      ),
    ).toEqual(["ca", "es"]);
    delete translated.lead.es;
    expect(
      createPreviewPostVariants(source([translated]), today).map(
        ({ locale }) => locale,
      ),
    ).toEqual(["ca"]);
  });

  it("does not require optional cover or correction translations for a complete variant", () => {
    const translated = createPost({
      slug: { ca: "exemple", es: "ejemplo" },
      title: { ca: "Exemple", es: "Ejemplo" },
      summary: { ca: "Resum", es: "Resumen" },
      lead: { ca: "Entradeta", es: "Entrada" },
      sections: [],
      cover: {
        resource: { kind: "local", path: "src/assets/posts/photo.jpg" },
        alt: { ca: "Foto" },
        attribution: { ca: "Autoria" },
      },
      correction: { date: today, note: { ca: "Correcció" } },
    });
    expect(
      createPreviewPostVariants(source([translated]), today).map(
        ({ locale }) => locale,
      ),
    ).toEqual(["ca", "es"]);
  });

  it("rejects duplicate identities and per-type localized slugs even for drafts", () => {
    const original = createPost();
    expect(() =>
      createPreviewPostVariants(source([original, original]), today),
    ).toThrow("Duplicate post id");
    const duplicateSlug = createPost({ id: "other-post" });
    expect(() =>
      createPublishedPostVariants(source([original, duplicateSlug]), today),
    ).toThrow("Duplicate news slugs in ca");
    const blog = createPost({
      id: "blog-example",
      type: "blog",
      author: { type: "person", name: "Autoria de prova" },
    });
    expect(
      createPreviewPostVariants(source([original, blog]), today),
    ).toHaveLength(2);
  });

  it.each([createPublishedPostVariants, createPreviewPostVariants])(
    "rejects missing references and future published dates in either selection",
    (select) => {
      expect(() =>
        select(
          source([createPost({ relatedEventIds: ["missing-event"] })]),
          today,
        ),
      ).toThrow("references missing event");
      expect(
        select(
          source([createPost({ relatedEventIds: ["club-event"] })]),
          today,
        ),
      ).toBeDefined();
      expect(() =>
        select(
          source([
            createPost({
              published: true,
              publishedAt: "2026-10-03T10:00:00+02:00",
            }),
          ]),
          today,
        ),
      ).toThrow("future publication date");
    },
  );

  it("uses Madrid dates rather than timestamp-local dates for the future check", () => {
    const post = createPost({
      published: true,
      publishedAt: "2026-10-02T23:30:00Z",
    });
    expect(() => createPublishedPostVariants(source([post]), today)).toThrow(
      "future publication date",
    );
  });

  it("orders by publication instant and stable id, then by draft preparation date", () => {
    const first = createPost({
      id: "first",
      slug: { ca: "primer" },
      published: true,
      publishedAt: "2026-10-02T09:00:00Z",
    });
    const second = createPost({
      id: "second",
      slug: { ca: "segon" },
      published: true,
      publishedAt: "2026-10-02T10:00:00+02:00",
    });
    const tied = createPost({
      id: "aaa",
      slug: { ca: "empat" },
      published: true,
      publishedAt: "2026-10-02T11:00:00+02:00",
    });
    const oldDraft = createPost({
      id: "old-draft",
      slug: { ca: "antic" },
      createdAt: "2026-09-01",
    });
    const draft = createPost();
    expect(
      createPreviewPostVariants(
        source([oldDraft, second, draft, first, tied]),
        today,
      ).map(({ entry }) => entry.id),
    ).toEqual(["aaa", "first", "second", draft.id, oldDraft.id]);
  });
});
