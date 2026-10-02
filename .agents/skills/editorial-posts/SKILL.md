---
name: editorial-posts
description: Prepare or revise Mountain Runners news and blog drafts, including Catalan requests to write a notícia or article de blog. Never publish without human editorial review.
---

# Editorial posts

1. Read `docs/editorial/guide.md`, the matching template in
   `docs/editorial/templates/`, `docs/specs/news-and-blog.md` and the existing
   draft before editing. Follow the repository's worktree and Git rules.
2. Ask for the confirmed facts, sources and intended reader question. If sources
   conflict, surface the discrepancy. Ask when a missing fact changes the meaning;
   omit nonessential unknown details instead of inventing them.
3. Write reader-facing content in Catalan. Load and apply `unslop`. Distinguish
   facts from opinions and provisional instructions. Never invent quotations,
   attendance, results, testimonials, photographs, prices or deadlines.
4. Sign posts as `mountain runners` with author type `organization`. Keep
   `published: false`. Preparation, a technical PR and a preview are not editorial
   approval. Do not assign a publication timestamp from an event date.
5. Use the strict YAML posts contract. Only add complete translations; never use
   Catalan fallback in another locale. Use restricted Markdown, no HTML or MDX.
6. Add a cover only after reviewing the actual approved image, rights, alt and
   credit. Keep consent records outside this public repository. Never put
   draft-only assets in `public/`.
7. Link authoritative membership information rather than duplicating mutable
   conditions. Do not enter personal or payment data to test a form.
8. Record unresolved editorial questions separately from reader-facing text.
   Request human review of facts, translations, rights and publication date.
   A request to publish without review does not authorize publishing, merging,
   pushing, preview activation or deployment.
9. Run the relevant content checks and report what was actually verified. Keep
   public build draft isolation intact; preview visibility applies only to posts.
