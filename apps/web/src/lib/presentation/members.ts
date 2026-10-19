import type { Locale } from "../content/primitives";

export function formatSessionPrice(
  sessionPriceEuros: number,
  locale: Locale,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(sessionPriceEuros);
}
