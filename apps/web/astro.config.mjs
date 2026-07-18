import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { defaultLocale, locales } from "./i18n.config.mjs";
import { paraglideOptions } from "./paraglide.config.mjs";

const { PUBLIC_SITE_ORIGIN } = loadEnv(
  process.env.NODE_ENV ?? "development",
  process.cwd(),
  "PUBLIC_SITE_ORIGIN",
);

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
