import {
  assinar,
  mensagemDesafioSinalizacao,
  mensagemFingerprintDtls,
  normalizarFingerprintDtls,
  verificar,
} from "@slate/identidade";
import {
  CAPACIDADES,
  acaoExecutarResposta,
  acaoResultado,
  criarEnvelope,
  contextoAlterado,
  deckEstado,
  hello,
  type AtalhoDeDeck,
  type PerfilDeDeck,
  mensagemServidorSinalizacao,
  negociar,
  novoEstadoSessao,
  reiniciarSequencia,
  validarConteudo,
  validarEnvelope,
  type EstadoConexao,
  type MensagemServidorSinalizacao,
} from "@slate/protocol";
import { api } from "./api";
import {
  removerParesRevogados,
  type IdentidadeGuardada,
  type ParConfiavel,
} from "./identidade-local";

const VERSAO_APP = "0.1.0";
const TEMPO_ABERTURA_MS = 15_000;
const MAX_ESPERA_RECONEXAO_MS = 15_000;

export interface OpcoesTransporteWebRtc {
  identidade: IdentidadeGuardada;
  agente: ParConfiavel;
  aoMudarEstado: (estado: EstadoConexao) => void;
  aoNegociarCapacidades?: (capacidades: readonly string[]) => void;
  /**
   * A lista de atalhos de programa cadastrados naquele computador.
   *
   * Chamada com a lista inteira, uma vez, quando a última fatia chega — e com
   * lista vazia quando o canal cai, junto com as capacidades. Deck de um
   * computador não pode sobreviver à conexão que o trouxe: ele viraria uma
   * grade de teclas de outra máquina, ou de uma permissão já retirada.
   */
  aoReceberDeck?: (deck: DeckRecebido) => void;
  /**
   * O computador passou a pedir outro painel, por causa do programa em
   * primeiro plano. Só chega de Agentes com regra configurada.
   */
  aoMudarContexto?: (perfilId: string) => void;
  /** Usado pelo teste de relay; produção deixa o ICE escolher o melhor caminho. */
  politicaIce?: RTCIceTransportPolicy;
}

export interface DeckRecebido {
  atalhos: readonly AtalhoDeDeck[];
  perfis: readonly PerfilDeDeck[];
  perfilPadraoId?: string;
}

export interface ResultadoExecucaoAcao {
  ok: boolean;
  mensagem: string;
}

/**
 * Ciclo de vida do transporte da superfície.
 *
 * A classe não conhece React nem controles. Ela só expõe um estado verdadeiro
 * e, no futuro, bytes validados. Isso impede a interface de confundir
 * "WebSocket autenticado" com "computador pronto para receber comandos".
 */
export class TransporteWebRtc {
  private websocket?: WebSocket;
  private par?: RTCPeerConnection;
  private canal?: RTCDataChannel;
  private dispositivoId?: string;
  private sessaoId?: string;
  private encerrado = false;
  private jaConectou = false;
  private tentativa = 0;
  private geracao = 0;
  private temporizador?: ReturnType<typeof setTimeout>;
  private timeoutAbertura?: ReturnType<typeof setTimeout>;
  private timeoutDesconectado?: ReturnType<typeof setTimeout>;
  private reiniciandoIce = false;
  private candidatosPendentes: RTCIceCandidateInit[] = [];
  private estadoRecepcao = novoEstadoSessao();
  /** Fatias de `deck.estado` recebidas até agora, nesta sessão. */
  private deckParcial: AtalhoDeDeck[] = [];
  private perfisDeckParcial: readonly PerfilDeDeck[] = [];
  private perfilPadraoParcial?: string;
  private pendentes = new Map<
    string,
    { resolver: (resultado: ResultadoExecucaoAcao) => void; limite: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly opcoes: OpcoesTransporteWebRtc) {}

  iniciar(): void {
    window.addEventListener("online", this.aoFicarOnline);
    window.addEventListener("offline", this.aoFicarOffline);
    if (!navigator.onLine) {
      this.mudarEstado("OFFLINE");
      return;
    }
    this.iniciarConexao();
  }

  parar(): void {
    this.encerrado = true;
    this.geracao += 1;
    window.removeEventListener("online", this.aoFicarOnline);
    window.removeEventListener("offline", this.aoFicarOffline);
    this.limparTemporizadores();
    this.fecharCanais();
  }

  /** Não existe fila: sem canal aberto, a chamada é recusada imediatamente. */
  enviar(envelope: unknown): boolean {
    if (this.canal?.readyState !== "open") return false;
    this.canal.send(JSON.stringify(envelope));
    return true;
  }

  executarAcao(actionId: string): Promise<ResultadoExecucaoAcao> {
    if (this.canal?.readyState !== "open" || !this.jaConectou) {
      return Promise.resolve({
        ok: false,
        mensagem: "O computador não está conectado.",
      });
    }
    const envelope = criarEnvelope("req", "action.execute", { actionId });
    return new Promise((resolver) => {
      const limite = setTimeout(() => {
        this.pendentes.delete(envelope.id);
        resolver({ ok: false, mensagem: "O computador não respondeu a tempo." });
      }, 10_000);
      this.pendentes.set(envelope.id, { resolver, limite });
      if (!this.enviar(envelope)) {
        clearTimeout(limite);
        this.pendentes.delete(envelope.id);
        resolver({ ok: false, mensagem: "O computador não está conectado." });
      }
    });
  }

  private readonly aoFicarOnline = () => {
    if (this.encerrado) return;
    this.tentativa = 0;
    this.iniciarConexao();
  };

  private readonly aoFicarOffline = () => {
    this.geracao += 1;
    this.limparTemporizadores();
    this.fecharCanais();
    this.mudarEstado("OFFLINE");
  };

  private async conectar(): Promise<void> {
    if (this.encerrado || !navigator.onLine) return;

    const geracao = ++this.geracao;
    this.limparTemporizadores();
    this.fecharCanais();
    this.mudarEstado(this.jaConectou ? "RECONNECTING" : "CONNECTING");

    const desafio = await api.pedirDesafioSinalizacao(
      this.opcoes.identidade.chavePublicaExportada,
    );
    if (geracao !== this.geracao || this.encerrado) return;
    if (!desafio.ok) return this.tratarFalhaHttp(desafio.status);

    const mensagem = mensagemDesafioSinalizacao({
      desafioId: desafio.dados.desafioId,
      dispositivoId: desafio.dados.dispositivoId,
      nonce: desafio.dados.nonce,
      expiraEm: desafio.dados.expiraEm,
    });
    const assinatura = await assinar(this.opcoes.identidade, mensagem);
    if (geracao !== this.geracao || this.encerrado) return;

    const token = await api.trocarDesafioSinalizacao({
      desafioId: desafio.dados.desafioId,
      nonce: desafio.dados.nonce,
      assinatura,
    });
    if (geracao !== this.geracao || this.encerrado) return;
    if (!token.ok) return this.tratarFalhaHttp(token.status);

    this.dispositivoId = desafio.dados.dispositivoId;
    this.abrirWebSocket(desafio.dados.urlSinalizacao, token.dados.token, geracao);
  }

  private abrirWebSocket(url: string, token: string, geracao: number): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.agendarReconexao();
      return;
    }
    this.websocket = socket;

    socket.addEventListener("open", () => {
      if (geracao !== this.geracao) return socket.close();
      socket.send(JSON.stringify({ tipo: "autenticar", token }));
    });

    socket.addEventListener("message", (evento) => {
      if (geracao !== this.geracao || typeof evento.data !== "string") return;
      void this.receberSinalizacao(evento.data, geracao).catch(() => {
        this.agendarReconexao();
      });
    });

    socket.addEventListener("close", () => {
      if (geracao !== this.geracao || this.encerrado) return;
      // O DataChannel sobrevive à sinalização. Só refazemos toda a sessão se o
      // canal de dados também não estiver saudável.
      if (this.canal?.readyState !== "open") this.agendarReconexao();
    });

    socket.addEventListener("error", () => {
      if (geracao === this.geracao && this.canal?.readyState !== "open") {
        this.agendarReconexao();
      }
    });
  }

  private async receberSinalizacao(bruto: string, geracao: number): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch {
      return this.agendarReconexao();
    }
    const analise = mensagemServidorSinalizacao.safeParse(json);
    if (!analise.success) return this.agendarReconexao();

    const mensagem = analise.data;
    if (mensagem.tipo === "pronto") {
      if (mensagem.dispositivoId !== this.dispositivoId || mensagem.papel !== "surface") {
        return this.agendarReconexao();
      }
      await this.criarOferta(geracao, mensagem.servidoresIce);
      return;
    }

    if (mensagem.tipo === "erro") {
      if (mensagem.codigo === "nao_autenticado") this.mudarEstado("AUTH_REQUIRED");
      else this.agendarReconexao();
      return;
    }

    if (mensagem.tipo === "indisponivel") {
      this.mudarEstado("AGENT_UNAVAILABLE");
      this.agendarReconexao("AGENT_UNAVAILABLE");
      return;
    }

    if (mensagem.tipo === "revogacoes") {
      await removerParesRevogados(mensagem.dispositivoIds);
      if (mensagem.dispositivoIds.includes(this.opcoes.agente.id)) {
        this.mudarEstado("PAIRING_REQUIRED");
        this.parar();
      }
      return;
    }

    if (mensagem.tipo === "configuracao-ice") {
      if (this.par) {
        this.par.setConfiguration({
          ...this.par.getConfiguration(),
          iceServers: mensagem.servidoresIce,
        });
      }
      return;
    }

    if (mensagem.origem !== this.opcoes.agente.id) return;

    if (mensagem.tipo === "resposta") await this.aceitarResposta(mensagem, geracao);
    else if (mensagem.tipo === "candidato") await this.adicionarCandidato(mensagem.candidato);
    else if (mensagem.tipo === "encerrar") this.agendarReconexao();
  }

  private async criarOferta(
    geracao: number,
    servidoresIce: RTCIceServer[],
  ): Promise<void> {
    if (!this.dispositivoId || geracao !== this.geracao) return;

    const par = new RTCPeerConnection({
      iceServers: servidoresIce,
      iceTransportPolicy: this.opcoes.politicaIce ?? "all",
    });
    const sessaoId = crypto.randomUUID();
    this.par = par;
    this.sessaoId = sessaoId;
    this.candidatosPendentes = [];
    this.estadoRecepcao = novoEstadoSessao();
    reiniciarSequencia();

    par.addEventListener("icecandidate", (evento) => {
      if (!evento.candidate || geracao !== this.geracao) return;
      this.enviarSinal({
        tipo: "candidato",
        destino: this.opcoes.agente.id,
        sessaoId,
        candidato: evento.candidate.toJSON(),
      });
    });
    par.addEventListener("connectionstatechange", () => {
      if (geracao !== this.geracao) return;
      if (par.connectionState === "connected") {
        if (this.timeoutDesconectado) clearTimeout(this.timeoutDesconectado);
        this.timeoutDesconectado = undefined;
        this.reiniciandoIce = false;
        if (this.jaConectou && this.canal?.readyState === "open") {
          this.mudarEstado("CONNECTED");
        }
      } else if (par.connectionState === "disconnected") {
        if (!this.timeoutDesconectado) {
          // `disconnected` pode ser uma oscilação curta de Wi‑Fi. Dar alguns
          // segundos evita derrubar um canal que se recuperaria sozinho.
          this.timeoutDesconectado = setTimeout(() => {
            this.timeoutDesconectado = undefined;
            void this.reiniciarIce(geracao);
          }, 4_000);
        }
      } else if (par.connectionState === "failed") {
        void this.reiniciarIce(geracao);
      }
    });

    const canal = par.createDataChannel("slate", { ordered: true });
    this.prepararCanal(canal, geracao);

    await par.setLocalDescription(await par.createOffer());
    await this.enviarOfertaAtual(geracao, sessaoId);

    this.timeoutAbertura = setTimeout(() => {
      if (this.canal?.readyState !== "open") this.agendarReconexao();
    }, TEMPO_ABERTURA_MS);
  }

  private async enviarOfertaAtual(geracao: number, sessaoId: string): Promise<void> {
    const par = this.par;
    if (
      geracao !== this.geracao ||
      !par?.localDescription?.sdp ||
      !this.dispositivoId
    ) {
      return;
    }

    const fingerprint = extrairFingerprintDtls(par.localDescription.sdp);
    if (!fingerprint) return this.agendarReconexao();
    const assinatura = await assinar(
      this.opcoes.identidade,
      mensagemFingerprintDtls({
        sessaoId,
        dispositivoId: this.dispositivoId,
        algoritmo: "sha-256",
        valor: fingerprint,
      }),
    );

    this.enviarSinal({
      tipo: "oferta",
      destino: this.opcoes.agente.id,
      sessaoId,
      sdp: par.localDescription.sdp,
      fingerprint: { algoritmo: "sha-256", valor: fingerprint, assinatura },
    });
  }

  private async reiniciarIce(geracao: number): Promise<void> {
    if (
      this.reiniciandoIce ||
      geracao !== this.geracao ||
      !this.par ||
      !this.sessaoId
    ) {
      return;
    }
    if (this.websocket?.readyState !== WebSocket.OPEN) {
      this.agendarReconexao();
      return;
    }

    this.reiniciandoIce = true;
    this.mudarEstado("RECONNECTING");
    try {
      this.par.restartIce();
      await this.par.setLocalDescription(
        await this.par.createOffer({ iceRestart: true }),
      );
      await this.enviarOfertaAtual(geracao, this.sessaoId);
      this.timeoutDesconectado = setTimeout(() => {
        this.timeoutDesconectado = undefined;
        if (this.par?.connectionState !== "connected") this.agendarReconexao();
      }, TEMPO_ABERTURA_MS);
    } catch {
      this.agendarReconexao();
    }
  }

  private async aceitarResposta(
    mensagem: Extract<MensagemServidorSinalizacao, { tipo: "resposta" }>,
    geracao: number,
  ): Promise<void> {
    if (
      geracao !== this.geracao ||
      !this.par ||
      mensagem.sessaoId !== this.sessaoId
    ) {
      return;
    }

    const noSdp = extrairFingerprintDtls(mensagem.sdp);
    if (!noSdp || noSdp !== normalizarFingerprintDtls(mensagem.fingerprint.valor)) {
      return this.agendarReconexao();
    }

    const assinaturaValida = await verificar(
      this.opcoes.agente.chavePublica,
      this.opcoes.agente.algoritmo,
      mensagemFingerprintDtls({
        sessaoId: mensagem.sessaoId,
        dispositivoId: mensagem.origem,
        algoritmo: "sha-256",
        valor: mensagem.fingerprint.valor,
      }),
      mensagem.fingerprint.assinatura,
    );
    if (!assinaturaValida) return this.agendarReconexao();

    await this.par.setRemoteDescription({ type: "answer", sdp: mensagem.sdp });
    for (const candidato of this.candidatosPendentes.splice(0)) {
      await this.par.addIceCandidate(candidato);
    }
  }

  private async adicionarCandidato(candidato: RTCIceCandidateInit): Promise<void> {
    if (!this.par?.remoteDescription) {
      this.candidatosPendentes.push(candidato);
      return;
    }
    await this.par.addIceCandidate(candidato);
  }

  private prepararCanal(canal: RTCDataChannel, geracao: number): void {
    this.canal = canal;
    canal.addEventListener("open", () => {
      if (geracao !== this.geracao || !this.dispositivoId) return;
      canal.send(
        JSON.stringify(
          criarEnvelope("evt", "session.hello", {
            protocolVersion: 1,
            appVersion: VERSAO_APP,
            role: "surface",
            deviceId: this.dispositivoId,
            capabilities: CAPACIDADES,
          }),
        ),
      );
    });
    canal.addEventListener("message", (evento) => {
      if (geracao !== this.geracao || typeof evento.data !== "string") return;
      this.receberDoCanal(evento.data);
    });
    canal.addEventListener("close", () => {
      if (geracao === this.geracao) this.agendarReconexao();
    });
    canal.addEventListener("error", () => {
      if (geracao === this.geracao) this.agendarReconexao();
    });
  }

  private receberDoCanal(bruto: string): void {
    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch {
      return;
    }
    const envelope = validarEnvelope(json, this.estadoRecepcao);
    if (!envelope.ok || !envelope.valor) return;
    const conteudo = validarConteudo(envelope.valor.k, envelope.valor.p);
    if (!conteudo.ok) return;

    if (envelope.valor.k === "action.execute.result") {
      const resposta = acaoExecutarResposta.safeParse(conteudo.valor);
      if (resposta.success && !resposta.data.accepted) {
        this.concluirPendente(resposta.data.executionId, {
          ok: false,
          mensagem:
            resposta.data.rejectedReason === "escopo_negado"
              ? "Este aparelho não tem permissão para essa ação."
              : "Essa ação não está disponível neste computador.",
        });
      }
      return;
    }

    if (envelope.valor.k === "action.result") {
      const resultado = acaoResultado.safeParse(conteudo.valor);
      if (resultado.success) {
        this.concluirPendente(resultado.data.executionId, {
          ok: resultado.data.ok,
          mensagem: resultado.data.ok
            ? "Comando executado no computador."
            : resultado.data.error ?? "O computador não conseguiu executar o comando.",
        });
      }
      return;
    }

    if (envelope.valor.k === "context.changed") {
      const contexto = contextoAlterado.safeParse(conteudo.valor);
      // Só a troca automática interessa aqui. `manual` e `fallback` descrevem
      // decisões que já aconteceram do lado de cá, e obedecê-las de volta
      // faria o painel discutir consigo mesmo.
      if (contexto.success && contexto.data.reason === "regra") {
        this.opcoes.aoMudarContexto?.(contexto.data.profileId);
      }
      return;
    }

    if (envelope.valor.k === "deck.estado") {
      const estado = deckEstado.safeParse(conteudo.valor);
      if (!estado.success) return;

      /*
       * A lista vem em fatias porque um DataChannel tem teto de mensagem, e o
       * deck carrega um PNG por atalho. Sem `parte`, coube inteira.
       *
       * Aplicar fatia por fatia faria a grade crescer na frente da pessoa a
       * cada pedaço que chega; e uma fatia perdida deixaria um deck pela
       * metade parecendo completo. Por isso só a última publica, e só quando a
       * contagem fecha.
       */
      const { atalhos, perfis, perfilPadraoId, parte, total } = estado.data;
      if (parte === undefined || total === undefined) {
        this.deckParcial = [];
        this.perfisDeckParcial = [];
        this.perfilPadraoParcial = undefined;
        this.opcoes.aoReceberDeck?.({
          atalhos,
          perfis: perfis ?? [],
          perfilPadraoId,
        });
        return;
      }

      if (parte === 1) {
        this.deckParcial = [];
        this.perfisDeckParcial = perfis ?? [];
        this.perfilPadraoParcial = perfilPadraoId;
      } else {
        if (perfis) this.perfisDeckParcial = perfis;
        if (perfilPadraoId) this.perfilPadraoParcial = perfilPadraoId;
      }
      this.deckParcial = [...this.deckParcial, ...atalhos];
      if (parte === total) {
        const completo = this.deckParcial;
        const perfisCompletos = this.perfisDeckParcial;
        const perfilPadraoCompleto = this.perfilPadraoParcial;
        this.deckParcial = [];
        this.perfisDeckParcial = [];
        this.perfilPadraoParcial = undefined;
        this.opcoes.aoReceberDeck?.({
          atalhos: completo,
          perfis: perfisCompletos,
          perfilPadraoId: perfilPadraoCompleto,
        });
      }
      return;
    }

    if (envelope.valor.k !== "session.hello") return;
    const remoto = hello.safeParse(conteudo.valor);
    if (!remoto.success || remoto.data.role !== "agent" || remoto.data.deviceId !== this.opcoes.agente.id) {
      return;
    }

    const negociacao = negociar(remoto.data);
    if (!negociacao.compativel) {
      this.mudarEstado("VERSION_MISMATCH");
      this.fecharCanais();
      return;
    }

    this.opcoes.aoNegociarCapacidades?.(negociacao.capacidades);
    this.jaConectou = true;
    this.tentativa = 0;
    if (this.timeoutAbertura) clearTimeout(this.timeoutAbertura);
    this.mudarEstado("CONNECTED");
  }

  private enviarSinal(mensagem: Record<string, unknown>): void {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(mensagem));
    }
  }

  private tratarFalhaHttp(status: number): void {
    if (status === 401) this.mudarEstado("AUTH_REQUIRED");
    else if (status === 404) this.mudarEstado("PAIRING_REQUIRED");
    else if (status === 0 && !navigator.onLine) this.mudarEstado("OFFLINE");
    else this.agendarReconexao();
  }

  private agendarReconexao(estado?: EstadoConexao): void {
    if (this.encerrado || this.temporizador) return;
    this.geracao += 1;
    this.fecharCanais();
    if (!navigator.onLine) return this.mudarEstado("OFFLINE");
    this.mudarEstado(estado ?? (this.jaConectou ? "RECONNECTING" : "CONNECTING"));

    const base = Math.min(1_000 * 2 ** this.tentativa++, MAX_ESPERA_RECONEXAO_MS);
    const espera = Math.round(base * (0.8 + Math.random() * 0.4));
    this.temporizador = setTimeout(() => {
      this.temporizador = undefined;
      this.iniciarConexao();
    }, espera);
  }

  private fecharCanais(): void {
    this.opcoes.aoNegociarCapacidades?.([]);
    // O deck cai junto com as capacidades, e pelo mesmo motivo: ele descreve
    // aquele computador, naquela sessão, sob aquela permissão.
    this.deckParcial = [];
    this.perfisDeckParcial = [];
    this.perfilPadraoParcial = undefined;
    this.opcoes.aoReceberDeck?.({ atalhos: [], perfis: [] });
    for (const [id] of this.pendentes) {
      this.concluirPendente(id, {
        ok: false,
        mensagem: "A conexão caiu antes de o computador responder.",
      });
    }
    this.canal?.close();
    this.par?.close();
    this.websocket?.close();
    this.canal = undefined;
    this.par = undefined;
    this.websocket = undefined;
    this.sessaoId = undefined;
  }

  private concluirPendente(id: string, resultado: ResultadoExecucaoAcao): void {
    const pendente = this.pendentes.get(id);
    if (!pendente) return;
    clearTimeout(pendente.limite);
    this.pendentes.delete(id);
    pendente.resolver(resultado);
  }

  private limparTemporizadores(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.timeoutAbertura) clearTimeout(this.timeoutAbertura);
    if (this.timeoutDesconectado) clearTimeout(this.timeoutDesconectado);
    this.temporizador = undefined;
    this.timeoutAbertura = undefined;
    this.timeoutDesconectado = undefined;
  }

  private iniciarConexao(): void {
    void this.conectar().catch(() => this.agendarReconexao());
  }

  private mudarEstado(estado: EstadoConexao): void {
    this.opcoes.aoMudarEstado(estado);
  }
}

export function extrairFingerprintDtls(sdp: string): string | null {
  const correspondencia = sdp.match(/^a=fingerprint:sha-256\s+([^\r\n]+)$/im);
  return correspondencia?.[1]
    ? normalizarFingerprintDtls(correspondencia[1])
    : null;
}
