import eslint from "@eslint/js";
import astro from "eslint-plugin-astro";
import yml from "eslint-plugin-yml";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".worktrees/**",
      "**/.astro/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.playwright-mcp/**",
      // Sandbox temporary directories: Playwright writes generated files there,
      // and the repository never lints or commits them.
      "**/.agent-runtime-tmp/**",
      "**/.agent-check.*/**",
      // Symbolic links to .agents/skills/, which ESLint already reads once.
      "**/.claude/skills/**",
    ],
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
    // Paraglide emits an initialization that ESLint treats as unused.
    rules: {
      "no-useless-assignment": "off",
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["apps/web/public/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
