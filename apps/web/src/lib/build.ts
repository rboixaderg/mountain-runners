// Node consumers do not provide import.meta.env; only Astro builds set preview mode.
export const isPreviewBuild = import.meta.env?.PUBLIC_PREVIEW === "true";
