import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ambiente de desenvolvimento com a conta de verdade.
 *
 * Sobe a API e a PWA nesta máquina, contra o banco de produção, e publica a
 * PWA num endereço HTTPS temporário para que o celular alcance. O objetivo é
 * um só: encurtar o ciclo. Sem isto, ver uma mudança no celular exigia build,
 * deploy e — quando o Agente mudava — uma release nova instalada à mão.
 *
 * Por que túnel, e não o endereço da máquina na rede local: a câmera do
 * leitor de QR e o service worker só existem em contexto seguro. `http://` num
 * IP da rede não é contexto seguro, e no iPhone não há atalho para contornar
 * isso — o Safari simplesmente não oferece a câmera.
 *
 * São dois túneis porque são dois protocolos: a PWA fala HTTP na 4400 (e ela
 * mesma repassa `/api` para a 4500, do lado do servidor), enquanto a
 * sinalização é um WebSocket que sobe direto do navegador para a 4500. Um
 * túnel só não atende os dois, e a sinalização de produção não serve: ela
 * confere a origem do navegador contra a lista do Railway, que não conhece um
 * endereço temporário.
 */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_API = resolve(RAIZ, "services/api/.env.local");

const filhos = [];
let encerrando = false;

function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const filho of filhos) filho.kill();
  process.exit(codigo);
}

for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => encerrar(0));

function morrer(mensagem) {
  console.error(`\n  ${mensagem}\n`);
  encerrar(1);
}

/** Leitor de `.env` suficiente para este arquivo: `CHAVE=valor`, um por linha. */
function lerEnv(conteudo) {
  const env = {};
  for (const linha of conteudo.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const igual = limpa.indexOf("=");
    if (igual === -1) continue;
    env[limpa.slice(0, igual).trim()] = limpa
      .slice(igual + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return env;
}

/*
 * Comando como texto único, e não como lista de argumentos.
 *
 * `pnpm` e `cloudflared` no Windows são scripts `.cmd`, que o Node só executa
 * através do shell. E passar uma lista de argumentos junto com o shell rende um
 * aviso de depreciação a cada processo — o alerta é sobre argumento vindo de
 * fora, que aqui não existe: tudo neste arquivo é literal.
 */
function executar(nome, comando, opcoes = {}, { essencial = true } = {}) {
  const filho = spawn(comando, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    ...opcoes,
  });
  filhos.push(filho);

  const escrever = (fluxo) => (dados) => {
    for (const linha of String(dados).split(/\r?\n/)) {
      if (linha.trim()) fluxo.write(`[${nome}] ${linha}\n`);
    }
  };
  filho.stdout.on("data", escrever(process.stdout));
  filho.stderr.on("data", escrever(process.stderr));
  filho.on("exit", (codigo) => {
    if (encerrando) return;
    // Processo não essencial que morre não derruba o ambiente. Fechar a janela
    // do Agente é uma coisa normal de se fazer, e não pode custar os túneis:
    // eles sorteiam endereço novo a cada abertura, e endereço novo significa
    // parear o celular de novo.
    if (!essencial) {
      console.error(
        `\n  [${nome}] saiu com código ${codigo}. O resto continua de pé.\n`,
      );
      return;
    }
    console.error(`\n  [${nome}] saiu com código ${codigo}. Encerrando o resto.\n`);
    encerrar(codigo ?? 1);
  });

  return filho;
}

/**
 * Abre um túnel e espera o endereço aparecer.
 *
 * O `cloudflared` anuncia a URL sorteada no stderr, e só depois dela é que o
 * túnel existe de fato — por isso a promessa, em vez de seguir em frente e
 * montar a configuração com um endereço que ainda não foi decidido.
 */
function abrirTunel(nome, porta) {
  return new Promise((resolver, rejeitar) => {
    const filho = executar(
      nome,
      `cloudflared tunnel --url http://localhost:${porta} --no-autoupdate`,
    );

    const prazo = setTimeout(
      () => rejeitar(new Error(`o túnel ${nome} não respondeu em 60 segundos`)),
      60_000,
    );

    // Acumula em vez de olhar cada pedaço isolado: a saída chega picada, e a
    // URL pode cair partida entre dois pedaços — o endereço passaria batido e
    // o script esperaria os 60 segundos inteiros por algo que já foi impresso.
    let saida = "";
    const procurar = (dados) => {
      saida += String(dados);
      const achado = saida.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!achado) return;
      clearTimeout(prazo);
      filho.stderr.off("data", procurar);
      filho.stdout.off("data", procurar);
      resolver(achado[0]);
    };

    filho.stderr.on("data", procurar);
    filho.stdout.on("data", procurar);
  });
}

// ---- Conferências antes de subir qualquer coisa ---------------------------
//
// Tudo que pode faltar é conferido aqui, antes do primeiro processo. Subir o
// túnel e a PWA para só então a API morrer por falta de configuração deixaria
// uma tela carregando para sempre, sem dizer o que houve.

const conteudoEnv = await readFile(ENV_API, "utf8").catch(() => null);
if (conteudoEnv === null) {
  morrer(`Não encontrei ${ENV_API}.`);
}

const envApi = lerEnv(conteudoEnv);
if (!envApi.DATABASE_URL) {
  morrer(
    "DATABASE_URL está vazia em services/api/.env.local.\n" +
      "  Cole ali a URL pública do Postgres (painel do Railway, serviço do banco).\n" +
      "  O arquivo é ignorado pelo git.",
  );
}

const temCloudflared = await new Promise((r) => {
  const teste = spawn("cloudflared --version", { stdio: "ignore", shell: true });
  teste.on("error", () => r(false));
  teste.on("exit", (codigo) => r(codigo === 0));
});

if (!temCloudflared) {
  morrer(
    "cloudflared não está instalado. Instale com:\n" +
      "  winget install --id Cloudflare.cloudflared",
  );
}

// ---- Túneis ---------------------------------------------------------------

console.log("\n  Abrindo os túneis…\n");

const [urlPwa, urlSinalizacao] = await Promise.all([
  abrirTunel("túnel-pwa", 4400),
  abrirTunel("túnel-sinal", 4500),
]).catch((erro) => morrer(erro.message));

const origemPwa = new URL(urlPwa).origin;
const wssSinalizacao = `${urlSinalizacao.replace(/^https:/, "wss:")}/sinalizacao`;

// ---- API ------------------------------------------------------------------

executar("api", "pnpm exec tsx src/main.ts", {
  cwd: resolve(RAIZ, "services/api"),
  env: {
    ...process.env,
    ...envApi,
    PORT: "4500",
    NODE_ENV: "development",
    // A origem é conferida por igualdade exata, e é isso que faz o endereço
    // sorteado precisar entrar aqui. Enfraquecer a conferência para aceitar
    // qualquer coisa terminada em trycloudflare.com seria trocar uma linha de
    // script por um buraco permanente.
    ORIGENS_PERMITIDAS: [origemPwa, "http://localhost:4400"].join(","),
    URL_SINALIZACAO: wssSinalizacao,
    /*
     * Cookie sem `Secure`, de propósito, e serve as duas pontas: pelo túnel a
     * conexão é HTTPS e o navegador aceita um cookie comum; em
     * `http://localhost` um cookie `Secure` seria recusado pelo WebKit. O
     * inverso não existe — não há valor que sirva para os dois com `Secure`
     * ligado.
     */
    COOKIE_SEGURO: "false",
  },
});

// ---- PWA ------------------------------------------------------------------

executar("pwa", "pnpm --filter @slate/pwa dev", {
  cwd: RAIZ,
  env: {
    ...process.env,
    API_URL: "http://localhost:4500",
    URL_SINALIZACAO_PUBLICA: wssSinalizacao,
    // O Next recusa requisições de desenvolvimento vindas de um host que não
    // seja o dele; o endereço do túnel é justamente um outro host.
    DEV_ORIGENS_EXTRAS: new URL(urlPwa).host,
  },
});

// ---- Agente Desktop -------------------------------------------------------
//
// Sobe junto por padrão, e essa é a diferença que importa no dia a dia. Antes,
// ver uma mudança do Agente no celular passava por marcar tag, esperar a
// publicação e instalar o `.exe` à mão — dezenas de minutos para conferir uma
// linha. Aqui o mesmo código roda em perfil `debug`, sem LTO e sem
// `codegen-units = 1`: mudança em Rust reconstrói em torno de um minuto, e
// mudança só na interface é instantânea, sem tocar no Rust.
//
// Publicar release continua existindo para o que ela é: distribuir para outras
// máquinas. Não para testar na sua.

const semAgente = process.argv.includes("--sem-agente");

if (!semAgente) {
  executar(
    "agente",
    "pnpm --filter @slate/desktop tauri dev",
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        // Direto na porta local, sem passar pelo túnel: o Agente roda nesta
        // mesma máquina, e o túnel só existe porque o celular não alcança
        // `localhost`.
        SLATE_API_URL: "http://localhost:4500",
      },
    },
    { essencial: false },
  );
}

console.log(
  [
    "",
    "  ┌─────────────────────────────────────────────────────────────",
    `  │  Celular e navegador:  ${urlPwa}`,
    `  │  Sinalização:          ${wssSinalizacao}`,
    "  │",
    semAgente
      ? "  │  Agente Desktop:       não subiu (--sem-agente)."
      : "  │  Agente Desktop:       subindo em modo dev nesta máquina.",
    semAgente
      ? "  │    Para subir à mão:   SLATE_API_URL=http://localhost:4500"
      : "  │    Fechar a janela dele não derruba o resto.",
    "  │",
    "  │  Mudou Rust?      o Agente reconstrói sozinho (~1 min).",
    "  │  Mudou interface? recarrega na hora, sem recompilar.",
    "  │",
    "  │  Os endereços morrem junto com este processo (Ctrl+C).",
    "  └─────────────────────────────────────────────────────────────",
    "",
  ].join("\n"),
);
