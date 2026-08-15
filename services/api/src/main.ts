import { serve } from "@hono/node-server";
import { createDb } from "@slate/db";
import { ConfiguracaoInvalida, carregarConfig } from "./config";
import { criarServidor } from "./servidor";
import { limparSessoesExpiradas } from "./repositorio";

/**
 * Ponto de entrada do serviço.
 *
 * Falha ao subir, e não na primeira requisição: um serviço que sobe mal
 * configurado esconde o problema até alguém tentar usá-lo, e aí o sintoma
 * aparece longe da causa.
 */

let config;
try {
  config = carregarConfig();
} catch (erro) {
  if (erro instanceof ConfiguracaoInvalida) {
    console.error(`Configuração inválida: ${erro.message}`);
    process.exit(1);
  }
  throw erro;
}

const db = createDb(config.databaseUrl);
const app = criarServidor({ db, config });

/**
 * Varredura de sessões vencidas.
 *
 * A resolução de sessão já apaga a que encontra expirada, mas isso só alcança
 * quem volta. Sessão de quem nunca mais apareceu ficaria para sempre — daí a
 * limpeza periódica.
 */
const INTERVALO_LIMPEZA_MS = 60 * 60 * 1000;

const limpeza = setInterval(() => {
  limparSessoesExpiradas(db)
    .then((removidas) => {
      if (removidas > 0) console.log(`Sessões expiradas removidas: ${removidas}`);
    })
    .catch((erro) => console.error("Falha na limpeza de sessões:", erro));
}, INTERVALO_LIMPEZA_MS);

// Não segura o processo caso o resto termine.
limpeza.unref?.();

const servidor = serve(
  {
    fetch: app.fetch,
    port: config.porta,
    /*
     * Escuta em todas as interfaces, IPv6 incluído.
     *
     * A rede privada do Railway — por onde a PWA alcança este serviço sem sair
     * para a internet — é IPv6. O padrão do Node escuta apenas em IPv4, e o
     * efeito foi o proxy da PWA respondendo 500 com este serviço no ar e
     * saudável quando consultado pelo endereço público.
     */
    hostname: "::",
  },
  (info) => {
  console.log(
    `API do SLATE na porta ${info.port} ` +
      `(${config.producao ? "produção" : "desenvolvimento"}), ` +
      `origens permitidas: ${config.origensPermitidas.join(", ")}`,
  );
});

/**
 * Encerramento ordenado.
 *
 * O Railway manda SIGTERM antes de trocar uma versão. Sem tratar, requisições
 * em andamento morrem no meio e o usuário vê erro numa troca de versão que
 * deveria ser invisível.
 */
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    console.log(`${sinal} recebido, encerrando.`);
    clearInterval(limpeza);
    servidor.close(() => process.exit(0));

    // Rede de segurança: se alguma conexão não fechar, não ficamos presos.
    setTimeout(() => process.exit(0), 10_000).unref?.();
  });
}
