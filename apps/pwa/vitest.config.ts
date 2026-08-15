import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const raiz = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": raiz },
  },
});
