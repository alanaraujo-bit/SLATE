import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4400";

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
    // A PWA é feita para o celular; o desktop existe para tablets em modo
    // paisagem, que compartilham o mesmo layout largo.
    { name: "celular", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { ...devices["iPad (gen 7) landscape"] } },
  ],
});
