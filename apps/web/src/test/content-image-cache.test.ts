import { afterEach, expect, it, vi } from "vitest";
import { getLocalImageSize } from "../lib/content/images";
import { transformPostImage } from "../lib/content/post-images";

const logoPath = "src/assets/logo_mountain_runners.png";
const postPath = "src/content-assets/posts/com-fer-te-soci/resum.png";

afterEach(() => vi.unstubAllEnvs());

it("shares dimension reads by resource and application root only during builds", async () => {
  vi.stubEnv("PROD", true);
  const dimensions = getLocalImageSize(logoPath);
  expect(getLocalImageSize(logoPath)).toBe(dimensions);
  await expect(dimensions).resolves.toEqual({ width: 450, height: 444 });
  await expect(
    getLocalImageSize(logoPath, "/nonexistent"),
  ).resolves.toBeUndefined();

  vi.stubEnv("PROD", false);
  const developmentRead = getLocalImageSize(logoPath);
  expect(developmentRead).not.toBe(dimensions);
  await expect(developmentRead).resolves.toEqual({ width: 450, height: 444 });
});

it("shares WebP encodes by source and width only during builds", async () => {
  vi.stubEnv("PROD", true);
  const small = transformPostImage(postPath, 480);
  const large = transformPostImage(postPath, 1200);
  expect(transformPostImage(postPath, 480)).toBe(small);
  expect(large).not.toBe(small);
  const [smallImage, largeImage] = await Promise.all([small, large]);
  expect(smallImage.info).toMatchObject({ format: "webp", width: 480 });
  expect(largeImage.info.format).toBe("webp");
  expect(largeImage.info.width).toBeGreaterThan(smallImage.info.width);

  vi.stubEnv("PROD", false);
  const developmentEncode = transformPostImage(postPath, 480);
  expect(developmentEncode).not.toBe(small);
  await expect(developmentEncode).resolves.toEqual(smallImage);
});
