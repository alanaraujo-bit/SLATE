import { defineConfig, devices } from "@playwright/test";

/**
 * Onde os testes rodam.
 *
 * O padrão é local, para que rodar a suíte durante o desenvolvimento não
 * dependa de rede nem exercite o ambiente publicado. Para verificar produção,
 * basta apontar:
 *
 *   E2E_BASE_URL=https://slate.aionixdev.com pnpm test:e2e
 *
 * Vale rodar contra o endereço real de vez em quando: coisas como cookie
 * `Secure` e política de segurança só se comportam de verdade sob HTTPS, e
 * passam despercebidas em localhost.
 */
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
