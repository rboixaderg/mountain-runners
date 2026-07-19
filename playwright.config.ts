import { defineConfig } from "@playwright/test";

const desktopViewport = { width: 1280, height: 720 };
const mobileViewport = { width: 320, height: 720 };

export default defineConfig({
  testDir: "apps/web/e2e",
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
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
      PUBLIC_SITE_ORIGIN:
        process.env.PUBLIC_SITE_ORIGIN ?? "https://mountainrunners.cat",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:4321/ca/",
  },
});
