import type { APIRoute } from "astro";
import { isPreviewBuild } from "../lib/build";

export const GET: APIRoute = ({ site }) =>
  new Response(
    isPreviewBuild
      ? "User-agent: *\nDisallow: /\n"
      : `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", site)}\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
