import { getViteConfig } from "astro/config";
import { configDefaults } from "vitest/config";

// Rendering a `.astro` component through AstroContainer needs the Astro vite
// pipeline (and its Tailwind and Paraglide plugins). The render tests that
// already exist are listed explicitly; new ones use the `*-render.test.ts`
// suffix so they are picked up without editing this list.
const astroRenderTests = [
  "src/test/language-selector.test.ts",
  "src/test/members-action-section.test.ts",
  "src/test/members-services.test.ts",
  "src/test/public-layout.test.ts",
  "src/test/**/*-render.test.ts",
];

// These tests write `process.env`, rebuild the module graph or replace modules,
// so they keep one fresh module registry per file. The isolation they rely on is
// not the Astro pipeline: they run on the plain vite config.
const isolatedTests = [
  "src/test/analytics-events.test.ts",
  "src/test/build.test.ts",
  "src/test/content-image-cache.test.ts",
  "src/test/plausible-events-behavior.test.ts",
  "src/test/plausible.test.ts",
];

export default getViteConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    projects: [
      {
        test: {
          name: "astro",
          include: astroRenderTests,
        },
      },
      {
        extends: false,
        test: {
          name: "isolated",
          include: isolatedTests,
          environment: "node",
        },
      },
      {
        // Pure unit tests: no Astro, Tailwind or Paraglide pipeline and a shared
        // module registry, because none of them mutate `process.env` or modules.
        extends: false,
        test: {
          name: "unit",
          include: ["src/test/**/*.test.ts"],
          exclude: [
            ...configDefaults.exclude,
            "e2e/**",
            ...astroRenderTests,
            ...isolatedTests,
          ],
          environment: "node",
          isolate: false,
        },
      },
    ],
  },
});
