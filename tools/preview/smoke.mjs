import { setTimeout as sleep } from "node:timers/promises";

export async function verifyPreviewSite(
  origin,
  { request = fetch, wait = sleep } = {},
) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    try {
      const home = await request(`${origin}/ca/`);
      if (home.status === 200) break;
    } catch {
      // ACME may still be issuing the certificate after Caddy restarts.
    }
    if (attempt === 17) throw new Error("Preview TLS or DNS is not ready.");
    await wait(5_000);
  }
  for (const locale of ["ca", "es", "en"]) {
    const response = await request(`${origin}/${locale}/`);
    if (
      response.status !== 200 ||
      response.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive" ||
      response.headers.get("cache-control") !== "no-store"
    ) {
      throw new Error(`Preview ${locale} failed status or header checks.`);
    }
    const html = await response.text();
    if (
      !html.includes(`rel="canonical" href="${origin}/${locale}/"`) ||
      !html.includes("PREVIEW")
    ) {
      throw new Error(`Preview ${locale} has incorrect canonical or warning.`);
    }
  }
  const robots = await request(`${origin}/robots.txt`);
  if (robots.status !== 200 || !(await robots.text()).includes("Disallow: /")) {
    throw new Error("Preview robots.txt must disallow crawling.");
  }
  const missing = await request(`${origin}/not-a-preview-page`);
  if (
    missing.status !== 404 ||
    missing.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive"
  ) {
    throw new Error("Preview 404 must remain unavailable and noindex.");
  }
}
