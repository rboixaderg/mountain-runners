export const externalLinkAttributes = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export function getExternalHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}

export function getMailtoHref(emailAddress: string): string {
  return `mailto:${emailAddress}`;
}

export function getTelHref(phoneNumber: string): string {
  return `tel:${phoneNumber}`;
}

export function getMarkdownSafeEmailAddress(emailAddress: string): string {
  return emailAddress.replace(/[\\`*_[\]<>]/gu, "\\$&");
}
