// Shared by Astro configuration and the official artifact builders.
export function parsePreviewFlag(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("PUBLIC_PREVIEW must be true or false.");
}

export function requireArtifactMode(preview, environment = process.env) {
  const configured = environment.PUBLIC_PREVIEW;
  const selected = parsePreviewFlag(configured);
  if (configured !== undefined && configured !== "" && selected !== preview) {
    throw new Error("PUBLIC_PREVIEW conflicts with the artifact build mode.");
  }
  if (
    !preview &&
    environment.PUBLIC_SITE_ORIGIN !== "https://mountainrunners.cat"
  ) {
    throw new Error(
      "Production artifacts require https://mountainrunners.cat.",
    );
  }
  return preview ? "true" : "false";
}
