/** @type {import('prettier').Config} */
export default {
  plugins: ["prettier-plugin-astro", "prettier-plugin-tailwindcss"],
  proseWrap: "preserve",
  overrides: [
    {
      files: "*.astro",
      options: { parser: "astro" },
    },
  ],
};
