export const externalLinkAttributes = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export function getExternalHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}
