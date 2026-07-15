import eslint from "@eslint/js";
import astro from "eslint-plugin-astro";
import yml from "eslint-plugin-yml";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/.astro/**", "**/dist/**", "**/node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs["flat/recommended"],
  ...yml.configs.standard,
  ...yml.configs.prettier,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.yaml", "**/*.yml"],
    languageOptions: {
      parserOptions: {
        defaultYAMLVersion: "1.2",
      },
    },
  },
  {
    files: [".github/workflows/*.{yaml,yml}"],
    rules: {
      "yml/no-empty-mapping-value": "off",
    },
  },
  {
    files: ["apps/web/src/paraglide/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
