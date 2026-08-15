import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Os testes de token são puros e rodariam em Node; os de componente
    // precisam de DOM. happy-dom serve os dois e é bem mais leve que jsdom.
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  esbuild: {
    jsx: "automatic",
  },
});
