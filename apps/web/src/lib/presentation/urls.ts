export function getExternalHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}
