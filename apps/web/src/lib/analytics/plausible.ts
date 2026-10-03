export const plausibleAnalytics = {
  domain: "mountainrunners.cat",
  endpoint: "https://analytics.rogerbg.cat/api/event",
  origin: "https://analytics.rogerbg.cat",
  scriptPath: "/js/pa-gRKxE0JnFqvhkV5c5BUwD.js",
} as const;

export const plausibleScriptSrc = `${plausibleAnalytics.origin}${plausibleAnalytics.scriptPath}`;

// Pull request previews are untrusted, unreviewed content, not public traffic:
// no markup and no event reach Plausible from them. The build switch is the
// same `PUBLIC_PREVIEW` contract the preview artifact and the preview notice
// already use, so the script, the metadata and the instrumented actions always
// agree with the artifact. `import.meta.env` is absent in the Node test runners
// that import these constants, which read production behaviour by default.
export const isPreviewBuild = import.meta.env?.PUBLIC_PREVIEW === "true";

export const analyticsEnabled = !isPreviewBuild;
