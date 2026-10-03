import { describe, expect, it } from "vitest";
import { postSchema } from "../lib/content/models";
import {
  formatPostDate,
  getPostPreviewMessageKey,
} from "../lib/presentation/posts";
import { getDomainPath, getVariantPath } from "../lib/content/routes";

describe("editorial presentation", () => {
  it("formats publication instants in Madrid rather than UTC", () => {
    expect(formatPostDate("2026-10-01T23:30:00Z", "en")).toBe(
      "October 2, 2026",
    );
  });
  it("keeps localized news and blog paths distinct", () => {
    expect(getDomainPath("news", "ca")).toBe("/ca/noticies/");
    expect(getDomainPath("news", "es")).toBe("/es/noticias/");
    expect(getDomainPath("news", "en")).toBe("/en/news/");
    expect(getDomainPath("blog", "ca")).toBe("/ca/blog/");
  });
  it("distinguishes a draft from a preview version marked for publication", () => {
    const entry = postSchema.parse({
      id: "example",
      type: "blog",
      published: false,
      slug: { ca: "example" },
      title: { ca: "Example" },
      summary: { ca: "Example" },
      lead: { ca: "Example" },
      sections: [],
      author: { type: "organization", name: "mountain runners" },
      createdAt: "2026-10-02",
    });
    expect(getPostPreviewMessageKey(entry)).toBe("posts_draft_status");
    expect(
      getPostPreviewMessageKey({
        ...entry,
        published: true,
        publishedAt: "2026-10-02T10:00:00Z",
      }),
    ).toBe("posts_published_status");
    expect(
      getVariantPath({ kind: "blog", locale: "ca", slug: "example", entry }),
    ).toBe("/ca/blog/example/");
  });
});
