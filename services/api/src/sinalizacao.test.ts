import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Database } from "@slate/db";
import type { Config } from "./config";
import { hashDoToken } from "./sessao";
import { criarSinalizacao, type Sinalizacao } from "./sinalizacao";
import type { DispositivoSinalizacao } from "./repositorio-sinalizacao";

const ORIGEM = "http://localhost:4400";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const SESSAO = "44444444-4444-4444-8444-444444444444";
const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const FINGERPRINT = Array.from({ length: 32 }, () => "AB").join(":");

const dispositivos: Record<string, DispositivoSinalizacao> = {
  [A]: {
    id: A,
    usuarioId: "conta-1",
    papel: "surface",
    chavePublica: "chave-a",
    algoritmo: "Ed25519",
  },
  [B]: {
    id: B,
    usuarioId: "conta-1",
    papel: "agent",
    chavePublica: "chave-b",
    algoritmo: "Ed25519",
  },
  [C]: {
    id: C,
    usuarioId: "outra-conta",
    papel: "agent",
    chavePublica: "chave-c",
    algoritmo: "Ed25519",
  },
};

describe("sinalização WSS", () => {
  let servidor: Server;
  let sinalizacao: Sinalizacao;
  let endereco: string;
  const clientes: WebSocket[] = [];
  let revogados: string[] = [];
  let dispositivosRevogados = new Set<string>();
  const tokens = new Map([
    [hashDoToken(TOKEN_A), A],
    [hashDoToken(TOKEN_B), B],
  ]);

  const config: Config = {
    producao: false,
    porta: 0,
    databaseUrl: "postgresql://teste",
    origensPermitidas: [ORIGEM],
    cookieSeguro: false,
    urlSinalizacao: "ws://localhost:4500/sinalizacao",
  };

  beforeEach(async () => {
    clientes.length = 0;
    revogados = [];
    dispositivosRevogados = new Set();
    const usados = new Set<string>();
    sinalizacao = criarSinalizacao({
      db: {} as Database,
      config,
      autenticarToken: async (hash) => {
        const id = tokens.get(hash);
        if (!id || usados.has(hash) || dispositivosRevogados.has(id)) return null;
        usados.add(hash);
        return { ...dispositivos[id]!, expiraEm: new Date(Date.now() + 60_000) };
      },
      podeAlcancar: async (origem, destinoId) => {
        const destino = dispositivos[destinoId];
        return Boolean(
          destino &&
            destino.usuarioId === origem.usuarioId &&
            destino.papel !== origem.papel,
        );
      },
      listarRevogados: async () => revogados,
      continuaAtivo: async () => true,
      obterIce: async () => ({
        servidoresIce: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        iceExpiraEm: null,
      }),
    });

    servidor = createServer((_req, resposta) => {
      resposta.writeHead(404).end();
    });
    sinalizacao.anexar(servidor);
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const porta = (servidor.address() as { port: number }).port;
    endereco = `ws://127.0.0.1:${porta}/sinalizacao`;
  });

  afterEach(async () => {
    for (const cliente of clientes) {
      cliente.on("error", () => undefined);
      if (cliente.readyState !== WebSocket.CONNECTING) cliente.terminate();
    }
    await sinalizacao.encerrar();
    await new Promise<void>((resolve, reject) =>
      servidor.close((erro) => (erro ? reject(erro) : resolve())),
    );
  });

  const conectar = async (origem = ORIGEM) => {
    const cliente = new WebSocket(endereco, { origin: origem });
    clientes.push(cliente);
    await new Promise<void>((resolve, reject) => {
      cliente.once("open", resolve);
      cliente.once("error", reject);
    });
    return cliente;
  };

  const proximaMensagem = (cliente: WebSocket) =>
    new Promise<Record<string, unknown>>((resolve) => {
      cliente.once("message", (dados) => resolve(JSON.parse(dados.toString())));
    });

  const autenticar = async (cliente: WebSocket, token: string) => {
    const resposta = proximaMensagem(cliente);
    cliente.send(JSON.stringify({ tipo: "autenticar", token }));
    return resposta;
  };

  it("recusa origem de navegador fora da allowlist no upgrade", async () => {
    const cliente = new WebSocket(endereco, { origin: "https://site-malicioso.test" });
    clientes.push(cliente);

    const status = await new Promise<number>((resolve) => {
      cliente.once("unexpected-response", (_pedido, resposta) => {
        const codigo = resposta.statusCode ?? 0;
        resposta.resume();
        resposta.once("end", () => resolve(codigo));
      });
    });

    expect(status).toBe(403);
  });

  it("exige token como primeira mensagem e o consome uma vez", async () => {
    const primeiro = await conectar();
    expect(await autenticar(primeiro, TOKEN_A)).toMatchObject({
      tipo: "pronto",
      dispositivoId: A,
    });

    const segundo = await conectar();
    const resposta = await autenticar(segundo, TOKEN_A);
    expect(resposta).toEqual({ tipo: "erro", codigo: "nao_autenticado" });
  });

  it("expõe presença somente enquanto o dispositivo está autenticado", async () => {
    const cliente = await conectar();
    expect(sinalizacao.estaOnline(A)).toBe(false);
    await autenticar(cliente, TOKEN_A);
    expect(sinalizacao.estaOnline(A)).toBe(true);
    cliente.close();
    await new Promise<void>((resolve) => cliente.once("close", () => resolve()));
    expect(sinalizacao.estaOnline(A)).toBe(false);
  });

  it("recusa no WebSocket um dispositivo revogado", async () => {
    dispositivosRevogados.add(A);
    const cliente = await conectar();
    expect(await autenticar(cliente, TOKEN_A)).toEqual({
      tipo: "erro",
      codigo: "nao_autenticado",
    });
  });

  it("sincroniza revogação pelo socket sem enviar chaves substitutas", async () => {
    revogados = [A];
    const agente = await conectar();
    const duasMensagens = new Promise<Record<string, unknown>[]>((resolve) => {
      const recebidas: Record<string, unknown>[] = [];
      agente.on("message", (dados) => {
        recebidas.push(JSON.parse(dados.toString()));
        if (recebidas.length === 2) resolve(recebidas);
      });
    });
    agente.send(JSON.stringify({ tipo: "autenticar", token: TOKEN_B }));
    const [pronto, revogacao] = await duasMensagens;
    expect(pronto).toMatchObject({ tipo: "pronto", dispositivoId: B });
    expect(revogacao).toEqual({
      tipo: "revogacoes",
      dispositivoIds: [A],
    });
  });

  it("encaminha somente o plano de controle e injeta a origem autenticada", async () => {
    const superficie = await conectar();
    const agente = await conectar();
    await autenticar(superficie, TOKEN_A);
    await autenticar(agente, TOKEN_B);

    const recebida = proximaMensagem(agente);
    superficie.send(
      JSON.stringify({
        tipo: "oferta",
        destino: B,
        sessaoId: SESSAO,
        sdp: "v=0",
        fingerprint: {
          algoritmo: "sha-256",
          valor: FINGERPRINT,
          assinatura: "x".repeat(64),
        },
      }),
    );

    expect(await recebida).toMatchObject({
      tipo: "oferta",
      origem: A,
      sessaoId: SESSAO,
    });
  });

  it("não deixa atravessar a fronteira entre contas", async () => {
    const superficie = await conectar();
    await autenticar(superficie, TOKEN_A);
    const resposta = proximaMensagem(superficie);

    superficie.send(
      JSON.stringify({ tipo: "encerrar", destino: C, sessaoId: SESSAO }),
    );

    expect(await resposta).toEqual({ tipo: "erro", codigo: "destino_invalido" });
  });
});
