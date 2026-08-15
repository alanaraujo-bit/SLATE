import { defineConfig, devices } from "@playwright/test";

/**
 * Os testes rodam contra o Centro de Controle em execução.
 *
 * Por decisão do operador (D-007) essa aplicação roda localmente contra o banco
 * na nuvem, então este é o endereço padrão. Apontar para outro ambiente é
 * apenas definir E2E_BASE_URL.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4300";

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
