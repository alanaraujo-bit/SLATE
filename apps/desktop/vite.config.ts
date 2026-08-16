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
    watch: {
      /*
       * Não vigiar `src-tauri/`.
       *
       * Sem isto o `tauri dev` não sobe no Windows. O Vite vigia a pasta do
       * projeto inteira, e `src-tauri/target/` é onde o Cargo escreve — quando
       * ele grava `slate_agente_lib.dll`, o Windows tranca o arquivo, o
       * watcher morre com `EBUSY` e derruba o `beforeDevCommand` antes de a
       * janela abrir. O erro aponta para o Vite e a causa é o Cargo, o que
       * torna a pista difícil de seguir.
       *
       * Nada aqui dentro é interface: a janela é `src/`, e é ela que precisa
       * recarregar ao salvar. Mudança em Rust é o próprio Tauri que percebe.
       */
      ignored: ["**/src-tauri/**"],
    },
  },
  clearScreen: false,
});
