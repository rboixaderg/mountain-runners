import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { postSchema } from "../lib/content/models";
import { parseRestrictedYaml } from "../lib/content/yaml";
import {
  createPublishedPostVariants,
  createPreviewPostVariants,
  getPostLocalResources,
} from "../lib/content/posts";
import { getPostSections } from "../lib/presentation/posts";

const fixture = parseRestrictedYaml(
  await readFile(new URL("./fixtures/post.yaml", import.meta.url), "utf8"),
  postSchema,
);
const image = {
  resource: {
    kind: "local" as const,
    path: "src/content-assets/posts/step.png",
  },
  alt: { ca: "Pantalla del formulari" },
  attribution: { ca: "mountain runners" },
};
const section = {
  heading: { ca: "Primer pas" },
  body: { ca: "Explicació del pas" },
  images: [image],
};

describe("section images", () => {
  it("accepts text-only sections, multiple images and an explicit personal author", () => {
    const post = postSchema.parse({
      ...fixture,
      sections: [
        fixture.sections[0],
        {
          ...section,
          images: [image, { ...image, caption: { ca: "Revisa les dades" } }],
        },
      ],
      author: { type: "person", name: "Autora convidada" },
    });
    expect(post.sections[0]!.images).toBeUndefined();
    expect(post.sections[1]!.images).toHaveLength(2);
    expect(post.author.name).toBe("Autora convidada");
  });
  it.each(
    [
      [],
      Array.from({ length: 11 }, () => image),
      [{ ...image, alt: { ca: " " } }],
      [{ ...image, attribution: undefined }],
      [
        {
          ...image,
          resource: { kind: "remote", url: "https://example.org/image.png" },
        },
      ],
      [{ ...image, resource: { kind: "local", path: "public/private.png" } }],
      [
        {
          ...image,
          resource: {
            kind: "local",
            path: "src/content-assets/../private.png",
          },
        },
      ],
    ].map((images) => ({ images })),
  )("rejects invalid image arrays %j", ({ images }) => {
    expect(
      postSchema.safeParse({ ...fixture, sections: [{ ...section, images }] })
        .success,
    ).toBe(false);
  });
  it("excludes a language with untranslated instructional images, without hiding them", () => {
    const post = postSchema.parse({
      ...fixture,
      slug: { ca: "exemple", es: "ejemplo" },
      title: { ca: "Títol", es: "Título" },
      summary: { ca: "Resum", es: "Resumen" },
      lead: { ca: "Inici", es: "Inicio" },
      sections: [{ body: { ca: "Pas", es: "Paso" }, images: [image] }],
    });
    const source = { posts: [post], eventIds: new Set<string>() };
    expect(
      createPreviewPostVariants(source, "2026-10-03").map(
        ({ locale }) => locale,
      ),
    ).toEqual(["ca"]);
    expect(createPublishedPostVariants(source, "2026-10-03")).toEqual([]);
    expect(
      getPostLocalResources(createPreviewPostVariants(source, "2026-10-03")),
    ).toEqual([image.resource.path]);
    const translated = {
      ...image,
      alt: { ca: "Pantalla", es: "Pantalla" },
      attribution: { ca: "Club", es: "Club" },
      caption: { ca: "Pas" },
    };
    post.sections[0]!.images = [translated];
    expect(createPreviewPostVariants(source, "2026-10-03")).toHaveLength(1);
    post.sections[0]!.images = [
      { ...translated, caption: { ca: "Pas", es: "Paso" } },
    ];
    expect(createPreviewPostVariants(source, "2026-10-03")).toHaveLength(2);
    expect(
      getPostLocalResources(createPreviewPostVariants(source, "2026-10-03")),
    ).toEqual([image.resource.path]);
  });
  it("alternates only illustrated sections, starting with image left", () => {
    const post = postSchema.parse({
      ...fixture,
      sections: [
        fixture.sections[0],
        section,
        fixture.sections[0],
        section,
        section,
      ],
    });
    expect(
      getPostSections(post).map(({ hasImages, imageOnLeft }) => ({
        hasImages,
        imageOnLeft,
      })),
    ).toEqual([
      { hasImages: false, imageOnLeft: false },
      { hasImages: true, imageOnLeft: true },
      { hasImages: false, imageOnLeft: false },
      { hasImages: true, imageOnLeft: false },
      { hasImages: true, imageOnLeft: true },
    ]);
  });
});
