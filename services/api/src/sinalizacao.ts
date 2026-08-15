import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Database } from "@slate/db";
import {
  mensagemClienteSinalizacao,
  type MensagemClienteSinalizacao,
  type MensagemServidorSinalizacao,
} from "@slate/protocol";
import { origemPermitida, type Config } from "./config";
import {
  obterConfiguracaoIce,
  type ConfiguracaoIce,
} from "./credenciais-turn";
import { hashDoToken } from "./sessao";
import {
  consumirTokenSinalizacao,
  dispositivoContinuaAtivo,
  dispositivoPodeAlcancar,
  listarDispositivosRevogados,
  type DispositivoSinalizacao,
} from "./repositorio-sinalizacao";

const CAMINHO = "/sinalizacao";
const TEMPO_AUTENTICACAO_MS = 5_000;
const JANELA_TAXA_MS = 10_000;
const MAX_MENSAGENS_POR_JANELA = 200;
const MAX_FILA_BYTES = 1_048_576;
const MAX_PAYLOAD_BYTES = 140 * 1024;
const INTERVALO_REVOGACAO_MS = 30_000;

interface SessaoSocket {
  dispositivo?: DispositivoSinalizacao;
  inicioJanela: number;
  mensagensNaJanela: number;
  temporizadorAutenticacao: ReturnType<typeof setTimeout>;
  temporizadorRevogacao?: ReturnType<typeof setInterval>;
  temporizadorIce?: ReturnType<typeof setTimeout>;
}

export interface Sinalizacao {
  anexar(servidor: Server): void;
  estaOnline(dispositivoId: string): boolean;
  encerrar(): Promise<void>;
}

export function criarSinalizacao({
  db,
  config,
  agora = () => new Date(),
  autenticarToken = (tokenHash, momento) =>
    consumirTokenSinalizacao(db, tokenHash, momento),
  podeAlcancar = (origem, destinoId) =>
    dispositivoPodeAlcancar(db, origem, destinoId),
  listarRevogados = (usuarioId) => listarDispositivosRevogados(db, usuarioId),
  continuaAtivo = (dispositivoId) => dispositivoContinuaAtivo(db, dispositivoId),
  obterIce = () => obterConfiguracaoIce(config),
}: {
  db: Database;
  config: Config;
  agora?: () => Date;
  autenticarToken?: (
    tokenHash: string,
    agora: Date,
  ) => Promise<(DispositivoSinalizacao & { expiraEm: Date }) | null>;
  podeAlcancar?: (
    origem: DispositivoSinalizacao,
    destinoId: string,
  ) => Promise<boolean>;
  listarRevogados?: (usuarioId: string) => Promise<string[]>;
  continuaAtivo?: (dispositivoId: string) => Promise<boolean>;
  obterIce?: () => Promise<ConfiguracaoIce>;
}): Sinalizacao {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const conexoes = new Map<string, WebSocket>();
  const sessoes = new WeakMap<WebSocket, SessaoSocket>();

  const enviar = (socket: WebSocket, mensagem: MensagemServidorSinalizacao) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(mensagem));
  };

  const falhar = (
    socket: WebSocket,
    codigo: Extract<MensagemServidorSinalizacao, { tipo: "erro" }> ["codigo"],
    fechar = false,
  ) => {
    enviar(socket, { tipo: "erro", codigo });
    if (fechar) socket.close(1008, codigo);
  };

  const autenticar = async (socket: WebSocket, token: string) => {
    const sessao = sessoes.get(socket);
    if (!sessao || sessao.dispositivo) return falhar(socket, "mensagem_invalida", true);

    const credencial = await autenticarToken(hashDoToken(token), agora());
    if (!credencial) return falhar(socket, "nao_autenticado", true);

    clearTimeout(sessao.temporizadorAutenticacao);
    sessao.dispositivo = credencial;

    const anterior = conexoes.get(credencial.id);
    if (anterior && anterior !== socket) anterior.close(4001, "conexao_substituida");
    conexoes.set(credencial.id, socket);

    let ice: ConfiguracaoIce;
    try {
      ice = await obterIce();
    } catch {
      // Falhar o provedor de relay não derruba o caminho direto. A ausência de
      // TURN ficará visível nos testes/telemetria, mas a LAN continua útil.
      console.error("TURN indisponível; a conexão tentará o caminho direto.");
      ice = {
        servidoresIce: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        iceExpiraEm: null,
      };
    }

    enviar(socket, {
      tipo: "pronto",
      dispositivoId: credencial.id,
      papel: credencial.papel,
      expiraEm: credencial.expiraEm.getTime(),
      ...ice,
    });

    const agendarAtualizacaoIce = (atual: ConfiguracaoIce) => {
      if (!atual.iceExpiraEm) return;
      const espera = Math.max(
        60_000,
        Math.floor((atual.iceExpiraEm - agora().getTime()) * 0.8),
      );
      sessao.temporizadorIce = setTimeout(() => {
        void obterIce()
          .then((nova) => {
            enviar(socket, { tipo: "configuracao-ice", ...nova });
            agendarAtualizacaoIce(nova);
          })
          .catch(() => {
            // Uma falha pontual não descarta a credencial ainda válida.
            sessao.temporizadorIce = setTimeout(
              () => agendarAtualizacaoIce(atual),
              60_000,
            );
            sessao.temporizadorIce.unref?.();
          });
      }, espera);
      sessao.temporizadorIce.unref?.();
    };
    agendarAtualizacaoIce(ice);
    const revogados = await listarRevogados(credencial.usuarioId);
    if (revogados.length > 0) {
      enviar(socket, { tipo: "revogacoes", dispositivoIds: revogados });
    }

    let verificando = false;
    sessao.temporizadorRevogacao = setInterval(() => {
      if (verificando || socket.readyState !== WebSocket.OPEN) return;
      verificando = true;
      void (async () => {
        if (!(await continuaAtivo(credencial.id))) {
          socket.close(4004, "dispositivo_revogado");
          return;
        }
        const ids = await listarRevogados(credencial.usuarioId);
        if (ids.length > 0) {
          enviar(socket, { tipo: "revogacoes", dispositivoIds: ids });
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          verificando = false;
        });
    }, INTERVALO_REVOGACAO_MS);
    sessao.temporizadorRevogacao.unref?.();
  };

  const encaminhar = async (
    socket: WebSocket,
    mensagem: Exclude<MensagemClienteSinalizacao, { tipo: "autenticar" }>,
  ) => {
    const origem = sessoes.get(socket)?.dispositivo;
    if (!origem) return falhar(socket, "nao_autenticado", true);

    if (!(await podeAlcancar(origem, mensagem.destino))) {
      return falhar(socket, "destino_invalido");
    }

    const destino = conexoes.get(mensagem.destino);
    if (!destino || destino.readyState !== WebSocket.OPEN) {
      enviar(socket, {
        tipo: "indisponivel",
        dispositivoId: mensagem.destino,
        sessaoId: mensagem.sessaoId,
      });
      return;
    }

    if (destino.bufferedAmount > MAX_FILA_BYTES) {
      return falhar(socket, "limite_excedido");
    }

    const { destino: _destino, ...conteudo } = mensagem;
    destino.send(JSON.stringify({ ...conteudo, origem: origem.id }));
  };

  wss.on("connection", (socket) => {
    const temporizadorAutenticacao = setTimeout(() => {
      falhar(socket, "nao_autenticado", true);
    }, TEMPO_AUTENTICACAO_MS);
    temporizadorAutenticacao.unref?.();

    sessoes.set(socket, {
      inicioJanela: agora().getTime(),
      mensagensNaJanela: 0,
      temporizadorAutenticacao,
    });

    socket.on("message", (dados, binario) => {
      void (async () => {
        if (binario) return falhar(socket, "mensagem_invalida", true);

        const sessao = sessoes.get(socket);
        if (!sessao) return;

        const momento = agora().getTime();
        if (momento - sessao.inicioJanela >= JANELA_TAXA_MS) {
          sessao.inicioJanela = momento;
          sessao.mensagensNaJanela = 0;
        }
        sessao.mensagensNaJanela += 1;
        if (sessao.mensagensNaJanela > MAX_MENSAGENS_POR_JANELA) {
          return falhar(socket, "limite_excedido", true);
        }

        let bruto: unknown;
        try {
          bruto = JSON.parse(dados.toString());
        } catch {
          return falhar(socket, "mensagem_invalida", true);
        }

        const analise = mensagemClienteSinalizacao.safeParse(bruto);
        if (!analise.success) return falhar(socket, "mensagem_invalida", true);

        if (analise.data.tipo === "autenticar") {
          await autenticar(socket, analise.data.token);
        } else {
          await encaminhar(socket, analise.data);
        }
      })().catch(() => falhar(socket, "mensagem_invalida", true));
    });

    socket.on("close", () => {
      const sessao = sessoes.get(socket);
      clearTimeout(sessao?.temporizadorAutenticacao);
      if (sessao?.temporizadorRevogacao) clearInterval(sessao.temporizadorRevogacao);
      if (sessao?.temporizadorIce) clearTimeout(sessao.temporizadorIce);
      if (sessao?.dispositivo && conexoes.get(sessao.dispositivo.id) === socket) {
        conexoes.delete(sessao.dispositivo.id);
      }
    });
  });

  const rejeitarUpgrade = (socket: Duplex, status: number, motivo: string) => {
    socket.write(
      `HTTP/1.1 ${status} ${motivo}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  };

  const aoUpgrade = (requisicao: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(requisicao.url ?? "/", "http://localhost");
    if (url.pathname !== CAMINHO) return rejeitarUpgrade(socket, 404, "Not Found");

    const origem = requisicao.headers.origin ?? null;
    // Clientes nativos não enviam Origin. Navegadores sempre enviam e precisam
    // corresponder exatamente à allowlist, sem curingas ou comparação por sufixo.
    if (origem !== null && !origemPermitida(origem, config)) {
      return rejeitarUpgrade(socket, 403, "Forbidden");
    }

    wss.handleUpgrade(requisicao, socket, head, (websocket) => {
      wss.emit("connection", websocket, requisicao);
    });
  };

  return {
    anexar(servidor) {
      servidor.on("upgrade", aoUpgrade);
    },
    estaOnline(dispositivoId) {
      return conexoes.get(dispositivoId)?.readyState === WebSocket.OPEN;
    },
    encerrar() {
      return new Promise((resolve) => {
        for (const socket of conexoes.values()) socket.close(1001, "servidor_encerrando");
        wss.close(() => resolve());
      });
    },
  };
}
