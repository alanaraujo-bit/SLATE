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

/**
 * Hosts extras aceitos pelo servidor de desenvolvimento.
 *
 * O Next só atende requisições de desenvolvimento cujo `Host` é o dele. Quando
 * a PWA é publicada por um túnel para chegar ao celular, o host é outro — e sem
 * esta lista os recursos de `/_next` são recusados, com a página carregando
 * pela metade. Vale apenas em desenvolvimento; em produção o campo é ignorado.
 */
const origensDeDesenvolvimento = (process.env.DEV_ORIGENS_EXTRAS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const config: NextConfig = {
  reactStrictMode: true,
  ...(origensDeDesenvolvimento.length > 0
    ? { allowedDevOrigins: origensDeDesenvolvimento }
    : {}),
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
            /*
             * O leitor de QR decodifica num Worker criado a partir de `blob:`
             * (`qr-scanner` faz `new Worker(URL.createObjectURL(...))`).
             *
             * Sem esta linha, `worker-src` recai para `child-src` e daí para
             * `script-src`, que não aceita `blob:` — e o navegador recusa o
             * worker. O sintoma foi cruel: no iPhone a câmera abria, a imagem
             * aparecia e o QR nunca era lido, sem erro nenhum, porque a falha
             * acontece dentro de uma promessa interna da biblioteca. No
             * Android nada disso aparecia: lá existe `BarcodeDetector` nativo
             * e o worker nem chega a ser criado.
             *
             * Declarar `worker-src` à parte mantém `script-src` fechado: quem
             * ganha `blob:` é só o worker, não o carregamento de script.
             */
            "worker-src 'self' blob:",
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
