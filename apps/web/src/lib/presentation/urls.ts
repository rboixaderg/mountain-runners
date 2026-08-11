export const externalLinkAttributes = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export function getExternalHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}

export function getMailtoAddress(mailtoUrl: string): string {
  return mailtoUrl.replace(/^mailto:/iu, "");
}

export function getMarkdownSafeMailtoAddress(mailtoUrl: string): string {
  return getMailtoAddress(mailtoUrl).replace(/[\\`*_[\]<>]/gu, "\\$&");
}
