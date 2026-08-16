/*
 * Service worker do SLATE.
 *
 * Escrito à mão em vez de gerado por biblioteca. O que esta PWA precisa é
 * estreito e específico — manter a casca do app disponível offline e nunca
 * servir estado velho do computador como se fosse atual — e as bibliotecas
 * genéricas trazem estratégias de cache que, aqui, seriam ativamente
 * prejudiciais.
 *
 * A regra que orienta tudo abaixo: dado sobre o estado do PC nunca é cacheado.
 * Um controle que mostra "gravando" a partir de um cache de dois minutos atrás
 * é pior que um controle que admite não saber.
 */

const VERSAO = "slate-v1";

/**
 * Este service worker foi gerado para o servidor de desenvolvimento?
 *
 * Substituído por `gerar-sw.mjs`. Existe porque a premissa que sustenta o
 * cache de ativos — **URL com hash no nome nunca muda de conteúdo** — vale no
 * build de produção e é falsa no `next dev`: ali os chunks se chamam
 * `/_next/static/chunks/app/page.js`, sem hash, e o conteúdo muda a cada
 * recompilação.
 *
 * O estrago é silencioso e caro de diagnosticar: a casca vem nova da rede, os
 * chunks vêm velhos do cache, o React nunca hidrata e a tela fica em
 * "Carregando…" para sempre — sem nenhum pedido chegando ao servidor, que é
 * justamente o rastro que faria alguém procurar o defeito no lugar certo.
 */
const DESENVOLVIMENTO = false;
const CACHE_CASCA = `${VERSAO}-casca`;
const CACHE_ATIVOS = `${VERSAO}-ativos`;

/** O mínimo para a aplicação abrir sem rede. */
const CASCA = ["/", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_CASCA);
      // `reload` evita gravar no cache uma resposta que o próprio navegador
      // já tinha em cache HTTP, o que reintroduziria a versão antiga.
      await cache.addAll(CASCA.map((url) => new Request(url, { cache: "reload" })));
      // Assume o controle imediatamente: numa PWA recém-instalada, esperar a
      // próxima visita significa a primeira sessão rodar sem offline.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((nome) => !nome.startsWith(VERSAO)).map((nome) => caches.delete(nome)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Caminhos que nunca podem ser servidos de cache. */
function nuncaCachear(url) {
  return (
    url.pathname.startsWith("/api/") ||
    // Fluxos em tempo real e sinalização não têm resposta para guardar.
    url.pathname.startsWith("/stream") ||
    url.pathname.startsWith("/sinalizacao")
  );
}

function ehAtivoEstatico(url) {
  // Em desenvolvimento nada de código é guardado: sem hash na URL, cache-first
  // entrega o pacote da compilação anterior junto com a casca nova. Ícones e
  // fontes continuam fora disso porque não participam do grafo do aplicativo.
  if (DESENVOLVIMENTO && (url.pathname.startsWith("/_next/") || /\.(?:css|js)$/.test(url.pathname))) {
    return false;
  }

  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:css|js|woff2?|png|svg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;

  if (requisicao.method !== "GET") return;

  const url = new URL(requisicao.url);

  // Requisição para outra origem não é assunto nosso.
  if (url.origin !== self.location.origin) return;

  if (nuncaCachear(url)) return;

  // Navegação: tenta a rede primeiro, porque a casca pode ter mudado. Sem
  // rede, entrega o que temos — e só se não houver nada é que aparece a tela
  // de offline.
  if (requisicao.mode === "navigate") {
    evento.respondWith(
      (async () => {
        try {
          const resposta = await fetch(requisicao);
          const cache = await caches.open(CACHE_CASCA);
          cache.put("/", resposta.clone());
          return resposta;
        } catch {
          const cache = await caches.open(CACHE_CASCA);
          return (
            (await cache.match(requisicao)) ??
            (await cache.match("/")) ??
            (await cache.match("/offline")) ??
            new Response("Offline", { status: 503, statusText: "Offline" })
          );
        }
      })(),
    );
    return;
  }

  // Ativos estáticos têm hash no nome: o conteúdo nunca muda para uma mesma
  // URL, então servir do cache é correto e instantâneo.
  if (ehAtivoEstatico(url)) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_ATIVOS);
        const guardado = await cache.match(requisicao);
        if (guardado) return guardado;

        const resposta = await fetch(requisicao);
        if (resposta.ok) cache.put(requisicao, resposta.clone());
        return resposta;
      })(),
    );
  }
});

// Permite que a página peça a troca imediata quando há versão nova, em vez de
// esperar todas as abas fecharem.
self.addEventListener("message", (evento) => {
  if (evento.data?.tipo === "ATUALIZAR_AGORA") self.skipWaiting();
});
