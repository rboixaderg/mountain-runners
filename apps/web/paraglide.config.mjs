import { locales } from "./i18n.config.mjs";

export const urlPatterns = [
  {
    pattern: "/",
    localized: locales.map((locale) => [locale, `/${locale}/`]),
  },
  {
    pattern: "/:path(.*)?",
    localized: locales.map((locale) => [locale, `/${locale}/:path(.*)?`]),
  },
];

export const paraglideOptions = {
  project: "./project.inlang",
  outdir: "./src/paraglide",
  strategy: ["url", "globalVariable"],
  urlPatterns,
  includeEslintDisableComment: false,
};
