import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const appDirectory = fileURLToPath(new URL("../", import.meta.url));

export function createPublicSiteOrigin(value) {
  if (value.trim() !== value) {
    throw new Error(
      "Public site origin must not contain surrounding whitespace",
    );
  }

  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("Public site origin must be a valid URL");
  }

  if (
    origin.protocol !== "https:" ||
    origin.hostname !== "mountainrunners.cat" ||
    origin.port !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.href !== `${value}/`
  ) {
    throw new Error("Public site origin must be https://mountainrunners.cat");
  }

  return origin;
}

export function loadPublicSiteOrigin(
  mode = process.env.NODE_ENV ?? "development",
) {
  const { PUBLIC_SITE_ORIGIN } = loadEnv(
    mode,
    appDirectory,
    "PUBLIC_SITE_ORIGIN",
  );
  return createPublicSiteOrigin(PUBLIC_SITE_ORIGIN ?? "");
}
