export const plausibleAnalytics = {
  domain: "mountainrunners.cat",
  endpoint: "https://analytics.rogerbg.cat/api/event",
  origin: "https://analytics.rogerbg.cat",
  scriptPath: "/js/pa-gRKxE0JnFqvhkV5c5BUwD.js",
} as const;

export const plausibleScriptSrc = `${plausibleAnalytics.origin}${plausibleAnalytics.scriptPath}`;
