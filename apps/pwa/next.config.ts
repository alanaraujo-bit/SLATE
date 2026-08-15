import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const raizWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@slate/design-system", "@slate/identidade", "@slate/protocol"],
  output: "standalone",
  outputFileTracingRoot: raizWorkspace,
  poweredByHeader: false,

  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        // A PWA comanda um computador. Uma injeção de script aqui consegue
        // usar a chave do dispositivo enquanto a página está aberta — limite
        // declarado no ADR-0004 —, então a política precisa ser restritiva.
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            // wss para sinalização; o canal de dados do WebRTC não passa por aqui.
            "connect-src 'self' wss: https:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
      ],
    },
    {
      // O service worker precisa poder controlar toda a origem, e não apenas
      // o caminho de onde foi servido.
      source: "/sw.js",
      headers: [
        { key: "Service-Worker-Allowed", value: "/" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      ],
    },
  ],
};

export default config;
