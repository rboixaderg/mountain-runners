import { defineConfig } from "@playwright/test";

const desktopViewport = { width: 1280, height: 720 };
const mobileViewport = { width: 320, height: 720 };

// The suite asserts against the built artifact, so the reference date must be
// the one the build used. The package scripts export the same origin and date
// to both build and browser tests; direct invocations should do the same.
const siteOrigin =
  process.env.PUBLIC_SITE_ORIGIN ?? "https://mountainrunners.cat";
const buildToday = process.env.BUILD_TODAY ?? "2026-08-04";

// Workers inherit this process environment, so the tests read the same origin
// and reference date that the preview server and the build used.
process.env.PUBLIC_SITE_ORIGIN = siteOrigin;
process.env.BUILD_TODAY = buildToday;

export default defineConfig({
  testDir: "apps/web/e2e",
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: "http://127.0.0.1:4321",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { browserName: "chromium", viewport: desktopViewport },
    },
    {
      name: "chromium-mobile",
      use: { browserName: "chromium", viewport: mobileViewport },
    },
    {
      name: "firefox-desktop",
      use: { browserName: "firefox", viewport: desktopViewport },
    },
    {
      name: "firefox-mobile",
      use: { browserName: "firefox", viewport: mobileViewport },
    },
    {
      name: "webkit-desktop",
      use: { browserName: "webkit", viewport: desktopViewport },
    },
    {
      name: "webkit-mobile",
      use: { browserName: "webkit", viewport: mobileViewport },
    },
  ],
  webServer: {
    command:
      "pnpm --filter @mountain-runners/web exec astro preview --host 127.0.0.1 --port 4321",
    env: {
      PUBLIC_SITE_ORIGIN: siteOrigin,
      // Astro 7.2 daemonizes `astro preview` when it detects an agentic
      // environment, which makes Playwright report "exited early". Keep the
      // preview in the foreground so Playwright owns its lifecycle.
      ASTRO_PREVIEW_BACKGROUND: "1",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:4321/ca/",
  },
});
