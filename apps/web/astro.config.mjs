import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { defaultLocale, locales } from "./i18n.config.mjs";
import { paraglideOptions } from "./paraglide.config.mjs";
import { parsePreviewFlag } from "./build-mode.mjs";

const { PUBLIC_SITE_ORIGIN, PUBLIC_PREVIEW } = loadEnv(
  process.env.NODE_ENV ?? "development",
  process.cwd(),
  "PUBLIC_",
);

parsePreviewFlag(PUBLIC_PREVIEW);

export default defineConfig({
  output: "static",
  site: PUBLIC_SITE_ORIGIN,
  i18n: {
    defaultLocale,
    locales,
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: true,
    },
  },
  vite: {
    plugins: [tailwindcss(), paraglideVitePlugin(paraglideOptions)],
  },
});
