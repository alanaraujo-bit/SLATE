import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // O Tauri serve a interface como arquivos locais; caminhos relativos evitam
  // que os recursos sejam procurados na raiz de um servidor que não existe.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome110",
  },
  server: {
    port: 4600,
    strictPort: true,
  },
  clearScreen: false,
});
