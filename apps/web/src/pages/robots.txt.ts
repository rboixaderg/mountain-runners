import type { APIRoute } from "astro";
import { getPublicSiteOrigin } from "../lib/content/routes";

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", getPublicSiteOrigin())}\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
