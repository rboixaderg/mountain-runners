import { defineMiddleware } from "astro:middleware";
import { assertIsLocale, setLocale } from "./paraglide/runtime.js";

export const onRequest = defineMiddleware((context, next) => {
  const locale = context.currentLocale;

  if (locale) {
    setLocale(assertIsLocale(locale));
  }

  return next();
});
