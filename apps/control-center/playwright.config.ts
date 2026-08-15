import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a deployed URL, never a local server.
 *
 * Mandate §15 forbids requiring local infrastructure to validate the product;
 * the test runner executing locally against a real cloud deployment is exactly
 * the cloud validation it asks for.
 */
const baseURL =
  process.env.E2E_BASE_URL ?? "https://slate-control-center.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
