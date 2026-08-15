import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const raizWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Endereço interno da API.
 *
 * Nunca vai para o navegador: a PWA fala com `/api` na própria origem, e este
 * processo repassa. Ver a explicação do proxy mais abaixo.
 */
const API_INTERNA = (process.env.API_URL ?? "http://localhost:4500").replace(/\/$/, "");
const URL_SINALIZACAO_PUBLICA =
  process.env.URL_SINALIZACAO_PUBLICA ??
  (process.env.NODE_ENV === "production"
    ? "wss://slate-api-staging.up.railway.app/sinalizacao"
    : "ws://localhost:4500/sinalizacao");
const origemSinalizacao = (() => {
  const url = new URL(URL_SINALIZACAO_PUBLICA);
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("URL_SINALIZACAO_PUBLICA precisa usar ws:// ou wss://.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "wss:") {
    throw new Error("URL_SINALIZACAO_PUBLICA precisa usar wss:// em produção.");
  }
  return url.origin;
})();

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@slate/design-system", "@slate/identidade", "@slate/protocol"],
  output: "standalone",
  outputFileTracingRoot: raizWorkspace,
  poweredByHeader: false,

  /**
   * A API é servida na mesma origem da PWA.
   *
   * Escrito depois de um teste falhar no WebKit e revelar o problema real: o
   * cookie de sessão não atravessava de `localhost:4400` para
   * `localhost:4500`. O cadastro respondia 201 e a requisição seguinte vinha
   * 401 — sessão criada e imediatamente perdida. Chromium aceitava; WebKit,
   * que é o motor de todo navegador no iPhone e no iPad, não.
   *
   * A alternativa seria acertar a configuração de domínio para que as duas
   * origens fossem o mesmo site, e torcer para que a proteção do Safari
   * concordasse. Servir tudo sob uma origem só é melhor por eliminação: o
   * cookie passa a ser de primeira parte, e não existe navegador que bloqueie
   * um cookie do próprio site. De quebra, o CORS deixa de ser necessário e a
   * exigência de subdomínios some.
   *
   * O Agente Desktop continua falando direto com a API — ele não usa cookie e
   * não é navegador, então nada disso se aplica a ele.
   */
  rewrites: async () => [
    { source: "/api/:caminho*", destination: `${API_INTERNA}/:caminho*` },
  ],

  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
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
            // O HTTP continua na própria origem pelo proxy. O upgrade WSS vai
            // direto ao processo persistente no Railway; liberar a origem
            // exata preserva a CSP contra exfiltração para qualquer outro WSS.
            `connect-src 'self' ${origemSinalizacao}`,
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
