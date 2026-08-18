export const externalLinkAttributes = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export function getExternalHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}

export function getSameOriginHref(href: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) {
    return href;
  }

  const url = new URL(href);
  return `${url.pathname}${url.search}${url.hash}`;
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
