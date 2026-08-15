import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const raiz = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Os arquivos em e2e/ são do Playwright: têm outro executor e outro
    // conjunto de expectativas. Sem esta exclusão o vitest tenta rodá-los e
    // falha de um jeito que não diz nada sobre o código.
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": raiz },
  },
});
