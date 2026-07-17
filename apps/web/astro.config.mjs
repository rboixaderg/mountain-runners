import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "astro/config";
import { defaultLocale, locales } from "./i18n.config.mjs";
import { paraglideOptions } from "./paraglide.config.mjs";

export default defineConfig({
  output: "static",
  site: "https://mountainrunners.cat",
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
