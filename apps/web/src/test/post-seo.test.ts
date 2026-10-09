import { describe, expect, it } from "vitest";
import { postSchema } from "../lib/content/models";
import { createPreviewPostVariants } from "../lib/content/posts";
import {
  getPostAlternatives,
  getPostJsonLd,
  getPostSitemapUrls,
} from "../lib/content/post-seo";
import { serializeJsonLd } from "../lib/content/seo";

const site = new URL("https://mountainrunners.cat");
const entry = postSchema.parse({
  id: "seo-example",
  type: "blog",
  published: false,
  slug: { ca: "exemple", es: "ejemplo" },
  title: { ca: "Text </script>", es: "Texto" },
  summary: { ca: "Resum" },
  lead: { ca: "Entradeta" },
  sections: [],
  author: { type: "organization", name: "mountain runners" },
  createdAt: "2026-10-02",
});

describe("post discovery", () => {
  it("excludes drafts and incomplete translations from indexing", () => {
    const variants = createPreviewPostVariants(
      { posts: [entry], eventIds: new Set() },
      "2026-10-02",
    );
    expect(variants).toHaveLength(1);
    expect(getPostJsonLd(variants[0]!, site)).toBeUndefined();
    expect(getPostSitemapUrls(variants, site)).toHaveLength(6);
    expect(getPostAlternatives(variants, variants[0]!, site)).toEqual([
      { locale: "ca", href: "https://mountainrunners.cat/ca/blog/exemple/" },
    ]);
  });
  it("emits coherent publication dates, organizational authors and safely serialized JSON-LD", () => {
    const post = {
      ...entry,
      published: true,
      publishedAt: "2026-10-02T10:00:00+02:00",
      updatedAt: "2026-10-02T11:00:00+02:00",
    };
    const variants = createPreviewPostVariants(
      { posts: [post], eventIds: new Set() },
      "2026-10-02",
    );
    const data = getPostJsonLd(variants[0]!, site)!;
    expect(data["@type"]).toBe("BlogPosting");
    expect(data.author).toEqual({
      "@type": "Organization",
      name: "mountain runners",
    });
    expect(data.datePublished).toBe(post.publishedAt);
    expect(data.dateModified).toBe(post.updatedAt);
    expect(data.image).toBeUndefined();
    expect(serializeJsonLd(data)).not.toContain("</script>");
    expect(getPostSitemapUrls(variants, site)).toContain(
      "https://mountainrunners.cat/ca/blog/exemple/",
    );
    expect(
      getPostJsonLd({ ...variants[0]!, kind: "news" }, site)!["@type"],
    ).toBe("NewsArticle");
  });
});
