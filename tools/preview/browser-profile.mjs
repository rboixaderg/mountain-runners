export function editorialBrowserNames(profile) {
  if (profile === undefined) {
    return ["chromium", "firefox", "webkit"];
  }
  if (profile === "chromium") {
    return ["chromium"];
  }
  throw new Error("Unknown editorial browser profile");
}
