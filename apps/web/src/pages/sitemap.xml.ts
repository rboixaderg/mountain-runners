import type { APIRoute } from "astro";
import { getPublicationCatalog } from "../lib/content/repository";
import { getSitemapUrls } from "../lib/content/routes";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/gu, (character) => {
    return {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    }[character]!;
  });
}

export const GET: APIRoute = async () => {
  const catalog = await getPublicationCatalog();
  const urls = getSitemapUrls(catalog)
    .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
