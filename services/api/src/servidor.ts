import { Hono, type Context, type Next } from "hono";
import type { Database } from "@slate/db";
import {
  ESCOPOS_PADRAO,
  pedidoDesafioSinalizacao,
  provaDesafioSinalizacao,
} from "@slate/protocol";
import {
  mensagemConfirmacaoPareamento,
  mensagemCriacaoConviteQr,
  verificar,
} from "@slate/identidade";
import {
  MAX_TENTATIVAS,
  VALIDADE_MS as VALIDADE_PAREAMENTO_MS,
  comparacaoSegura,
  formatarCodigo,
  gerarCodigo,
} from "@slate/identidade/pareamento";
import { origemPermitida, type Config } from "./config";
import {
  gastarTempoEquivalente,
  gerarHashSenha,
  validarSenha,
  verificarSenha,
} from "./senha";
import {
  VALIDADE_MS,
  criarTokenSessao,
  emailValido,
  hashDoToken,
  lerCookieSessao,
  montarCookie,
  montarCookieDeSaida,
  normalizarEmail,
  precisaRenovar,
} from "./sessao";
import {
  MAX_TENTATIVAS_JANELA,
  atualizarHashSenha,
  aceitarConvitePareamentoQr,
  bloquearPedido,
  buscarConvitePareamentoQrPorId,
  buscarConvitePareamentoQrPorToken,
  buscarDispositivoDaConta,
  buscarPedidoAtivo,
  buscarDispositivoPorChave,
  buscarResultadoPedidoPareamento,
  buscarUsuarioPorEmail,
  confirmarPedido,
  contarTentativas,
  criarDispositivo,
  criarConvitePareamentoQr,
  criarPedidoPareamento,
  criarSessao,
  criarUsuario,
  encerrarSessao,
  limparTentativas,
  listarDispositivos,
  registrarTentativa,
  registrarTentativaPareamento,
  resolverSessao,
  revogarDispositivo,
  type ContextoSessao,
} from "./repositorio";
import {
  emitirDesafioSinalizacao,
  trocarDesafioPorToken,
} from "./autenticacao-sinalizacao";
import { buscarDispositivoAtivoPorChave } from "./repositorio-sinalizacao";
import { ErroAtualizacoes, ServicoAtualizacoesGitHub } from "./atualizacoes";

/**
 * API do SLATE.
 *
 * Um único serviço para todo o lado servidor (ADR-0005). A sinalização WebRTC
 * mora aqui quando chegar, em vez de virar um segundo serviço.
 */

type Variaveis = { sessao: ContextoSessao };

export interface Dependencias {
  db: Database;
  config: Config;
  /** Injetável para os testes não dependerem do relógio. */
  agora?: () => Date;
  atualizacoes?: ServicoAtualizacoesGitHub;
  estaDispositivoOnline?: (dispositivoId: string) => boolean;
}

export function criarServidor({
  db,
  config,
  agora = () => new Date(),
  atualizacoes,
  estaDispositivoOnline = () => false,
}: Dependencias) {
  const app = new Hono<{ Variables: Variaveis }>();
  const servicoAtualizacoes =
    atualizacoes ??
    (config.releasesGitHub
      ? new ServicoAtualizacoesGitHub(config.releasesGitHub)
      : undefined);

  const opcoesCookie = {
    seguro: config.cookieSeguro,
    ...(config.dominioCookie ? { dominio: config.dominioCookie } : {}),
  };

  // ---- CORS ------------------------------------------------------------
  //
  // Origem devolvida explicitamente, nunca curinga: com `credentials`, o
  // navegador recusa `*` — e usar `*` aqui significaria abrir a API para
  // qualquer site.
  app.use("*", async (c, next) => {
    const origem = c.req.header("Origin") ?? null;

    if (origem && origemPermitida(origem, config)) {
      c.header("Access-Control-Allow-Origin", origem);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      c.header("Access-Control-Max-Age", "86400");
      // Sem isto, um cache intermediário poderia servir a resposta de uma
      // origem para outra.
      c.header("Vary", "Origin");
    }

    if (c.req.method === "OPTIONS") return c.body(null, 204);

    await next();
  });

  // ---- Verificação de origem -------------------------------------------
  //
  // Defesa em profundidade contra CSRF, independente do comportamento do
  // cookie: mesmo que um dia o SameSite mude, uma requisição que altera estado
  // vinda de outro site continua sendo recusada aqui.
  app.use("*", async (c, next) => {
    const metodoSeguro = c.req.method === "GET" || c.req.method === "HEAD";
    if (metodoSeguro) return next();

    const origem = c.req.header("Origin") ?? null;

    // Requisição sem Origin vem de cliente que não é navegador — o Agente
    // Desktop, por exemplo. Esses se autenticam por chave, não por cookie.
    if (origem === null) return next();

    if (!origemPermitida(origem, config)) {
      return c.json({ erro: "origem_nao_autorizada" }, 403);
    }

    await next();
  });

  // ---- Sessão -----------------------------------------------------------

  const exigirSessao = async (c: Context<{ Variables: Variaveis }>, next: Next) => {
    const token = lerCookieSessao(c.req.header("Cookie"));
    if (!token) return c.json({ erro: "nao_autenticado" }, 401);

    const sessao = await resolverSessao(db, token, agora());
    if (!sessao) return c.json({ erro: "nao_autenticado" }, 401);

    c.set("sessao", sessao);
    await next();
  };

  // ---- Saúde ------------------------------------------------------------

  app.get("/saude", async (c) => {
    try {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`select 1`);
      return c.json({ situacao: "ok", banco: "acessivel" });
    } catch {
      // O motivo não é exposto: mensagem de erro de banco costuma conter host
      // e usuário.
      return c.json({ situacao: "degradado", banco: "inacessivel" }, 503);
    }
  });

  // ---- Atualizações do Agente ------------------------------------------

  // Esta rota precisa vir antes da rota parametrizada logo abaixo. Em Hono,
  // "/download/11/22" também casa com "/:alvo/:arquitetura/:versao".
  app.get("/atualizacoes/download/:releaseId/:assetId", async (c) => {
    if (!servicoAtualizacoes) return c.json({ erro: "nao_encontrado" }, 404);
    const releaseId = Number(c.req.param("releaseId"));
    const assetId = Number(c.req.param("assetId"));
    if (!Number.isSafeInteger(releaseId) || !Number.isSafeInteger(assetId)) {
      return c.json({ erro: "nao_encontrado" }, 404);
    }
    try {
      return c.redirect(await servicoAtualizacoes.urlTemporaria(releaseId, assetId), 302);
    } catch (erro) {
      if (erro instanceof ErroAtualizacoes && erro.codigo === "pacote_ausente") {
        return c.json({ erro: "nao_encontrado" }, 404);
      }
      console.error("Falha ao entregar pacote de atualização:", erro);
      return c.json({ erro: "atualizacoes_indisponiveis" }, 503);
    }
  });

  app.get("/atualizacoes/:alvo/:arquitetura/:versao", async (c) => {
    if (!servicoAtualizacoes) {
      c.header("Retry-After", "3600");
      return c.json({ erro: "atualizacoes_indisponiveis" }, 503);
    }
    try {
      const resultado = await servicoAtualizacoes.consultar(
        c.req.param("alvo"),
        c.req.param("arquitetura"),
        c.req.param("versao"),
      );
      if (resultado.tipo === "nenhuma") return c.body(null, 204);
      return c.json({
        version: resultado.versao,
        notes: resultado.notas,
        pub_date: resultado.publicadaEm,
        url: resultado.url,
        signature: resultado.assinatura,
      });
    } catch (erro) {
      console.error("Falha ao consultar atualização:", erro);
      return c.json({ erro: "atualizacoes_indisponiveis" }, 503);
    }
  });

  // ---- Cadastro ---------------------------------------------------------

  app.post("/contas/cadastro", async (c) => {
    const corpo = await c.req.json().catch(() => null);
    if (!corpo || typeof corpo !== "object") {
      return c.json({ erro: "corpo_invalido" }, 400);
    }

    const { email, senha, nome } = corpo as Record<string, unknown>;

    if (typeof email !== "string" || !emailValido(email)) {
      return c.json({ erro: "email_invalido" }, 400);
    }

    if (typeof senha !== "string") {
      return c.json({ erro: "senha_invalida" }, 400);
    }

    const problemas = validarSenha(senha);
    if (problemas.length > 0) {
      return c.json({ erro: "senha_fraca", problemas }, 400);
    }

    const senhaHash = await gerarHashSenha(senha);

    let usuario;
    try {
      usuario = await criarUsuario(db, {
        email,
        senhaHash,
        ...(typeof nome === "string" && nome.trim() ? { nome: nome.trim() } : {}),
      });
    } catch {
      // A unicidade é do banco, então a colisão chega como erro. Responder
      // "e-mail já cadastrado" aqui entregaria quais endereços têm conta; a
      // resposta é a mesma de um cadastro bem-sucedido, e quem já tem conta
      // descobre ao tentar entrar.
      return c.json({ criado: true }, 201);
    }

    const token = criarTokenSessao(agora());
    await criarSessao(db, {
      usuarioId: usuario.id,
      tokenHash: token.hash,
      expiraEm: token.expiraEm,
      agenteUsuario: c.req.header("User-Agent") ?? null,
    });

    c.header("Set-Cookie", montarCookie(token.token, token.expiraEm, opcoesCookie));
    return c.json({ criado: true, usuario: { id: usuario.id, email: usuario.email } }, 201);
  });

  // ---- Entrada ----------------------------------------------------------

  app.post("/contas/entrada", async (c) => {
    const corpo = await c.req.json().catch(() => null);
    const { email, senha } = (corpo ?? {}) as Record<string, unknown>;

    if (typeof email !== "string" || typeof senha !== "string") {
      return c.json({ erro: "credenciais_invalidas" }, 400);
    }

    const chave = `entrada:${normalizarEmail(email)}`;

    if ((await contarTentativas(db, chave, agora())) >= MAX_TENTATIVAS_JANELA) {
      return c.json({ erro: "muitas_tentativas" }, 429);
    }

    const usuario = await buscarUsuarioPorEmail(db, email);

    if (!usuario) {
      // Gasta o tempo de uma verificação real: responder rápido para e-mail
      // inexistente entregaria quais endereços têm conta.
      await gastarTempoEquivalente();
      await registrarTentativa(db, chave);
      return c.json({ erro: "credenciais_invalidas" }, 401);
    }

    const resultado = await verificarSenha(senha, usuario.senhaHash);

    if (!resultado.confere) {
      await registrarTentativa(db, chave);
      // Mesma resposta de e-mail inexistente: a diferença é o que permite
      // descobrir contas.
      return c.json({ erro: "credenciais_invalidas" }, 401);
    }

    // Aproveita que a senha em claro está disponível para reforçar o hash
    // quando os parâmetros ficaram para trás.
    if (resultado.precisaAtualizar) {
      await atualizarHashSenha(db, usuario.id, await gerarHashSenha(senha));
    }

    await limparTentativas(db, chave);

    // Sessão nova a cada entrada: fecha fixação de sessão, em que alguém
    // planta um token conhecido antes do login.
    const token = criarTokenSessao(agora());
    await criarSessao(db, {
      usuarioId: usuario.id,
      tokenHash: token.hash,
      expiraEm: token.expiraEm,
      agenteUsuario: c.req.header("User-Agent") ?? null,
    });

    c.header("Set-Cookie", montarCookie(token.token, token.expiraEm, opcoesCookie));
    return c.json({ usuario: { id: usuario.id, email: usuario.email, nome: usuario.nome } });
  });

  // ---- Saída ------------------------------------------------------------

  app.post("/contas/saida", async (c) => {
    const token = lerCookieSessao(c.req.header("Cookie"));

    if (token) {
      const sessao = await resolverSessao(db, token, agora());
      if (sessao) await encerrarSessao(db, sessao.sessaoId);
    }

    // O cookie é apagado mesmo quando a sessão já não existia: a pessoa pediu
    // para sair, e sair precisa ser sempre bem-sucedido.
    c.header("Set-Cookie", montarCookieDeSaida(opcoesCookie));
    return c.json({ encerrada: true });
  });

  // ---- Sessão atual -----------------------------------------------------

  app.get("/contas/eu", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    return c.json({
      usuario: { id: sessao.usuarioId, email: sessao.email, nome: sessao.nome },
    });
  });

  // ---- Dispositivos -----------------------------------------------------

  app.get("/dispositivos", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const lista = await listarDispositivos(db, sessao.usuarioId);

    return c.json({
      dispositivos: lista.map((d) => ({
        id: d.id,
        nome: d.nome,
        papel: d.papel,
        situacao: d.situacao,
        escopos: d.escopos.split(" ").filter(Boolean),
        chavePublica: d.chavePublica,
        algoritmo: d.algoritmo,
        criadoEm: d.criadoEm,
        ultimoAcessoEm: d.ultimoAcessoEm,
        online: estaDispositivoOnline(d.id),
      })),
    });
  });

  /**
   * Registro do Agente.
   *
   * O Agente roda no computador da pessoa, então entrar ali já é prova de
   * posse da máquina — não precisa de código. É o caminho inverso do
   * pareamento de um celular.
   */
  app.post("/dispositivos/agente", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const { chavePublica, algoritmo, nome } = (corpo ?? {}) as Record<string, unknown>;

    if (
      typeof chavePublica !== "string" ||
      typeof algoritmo !== "string" ||
      typeof nome !== "string" ||
      chavePublica.length < 20 ||
      nome.trim().length === 0
    ) {
      return c.json({ erro: "dados_invalidos" }, 400);
    }

    try {
      const dispositivo = await criarDispositivo(db, {
        usuarioId: sessao.usuarioId,
        papel: "agent",
        nome: nome.trim().slice(0, 100),
        chavePublica,
        algoritmo,
        escopos: ESCOPOS_PADRAO.join(" "),
      });

      return c.json({ dispositivo: { id: dispositivo.id, nome: dispositivo.nome } }, 201);
    } catch {
      return c.json({ erro: "chave_ja_registrada" }, 409);
    }
  });

  app.delete("/dispositivos/:id", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const id = c.req.param("id");

    if (!id) return c.json({ erro: "nao_encontrado" }, 404);

    const revogado = await revogarDispositivo(db, sessao.usuarioId, id);

    if (!revogado) return c.json({ erro: "nao_encontrado" }, 404);
    return c.json({ revogado: true });
  });

  // ---- Pareamento -------------------------------------------------------

  /**
   * Por que uma chave já cadastrada não serve para este pareamento.
   *
   * Os três motivos pedem reações diferentes de quem chama, e por isso não
   * podem sair com o mesmo código: chave de outra conta é impasse; superfície
   * revogada se resolve no próprio aparelho, gerando identidade nova; papel
   * trocado é conflito de cadastro. Devolver tudo como "chave_ja_registrada"
   * deixava o aparelho preso num beco sem saída, e ainda dizia no Agente que o
   * problema era com o computador.
   */
  function motivoChaveIndisponivel(
    dispositivo: { usuarioId: string; papel: string; situacao: string },
    usuarioId: string,
  ): "chave_de_outra_conta" | "chave_ja_registrada" | "dispositivo_revogado" | null {
    if (dispositivo.usuarioId !== usuarioId) return "chave_de_outra_conta";
    if (dispositivo.papel !== "surface") return "chave_ja_registrada";
    if (dispositivo.situacao !== "ativo") return "dispositivo_revogado";
    return null;
  }

  /**
   * A superfície pede pareamento e recebe um código para exibir.
   *
   * O código não protege nada sozinho — ele prova que quem vai confirmar está
   * na frente do computador (ADR-0004 §2).
   */
  app.post("/pareamento/pedidos", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const { chavePublica, algoritmo, nome } = (corpo ?? {}) as Record<string, unknown>;

    if (
      typeof chavePublica !== "string" ||
      typeof algoritmo !== "string" ||
      typeof nome !== "string" ||
      chavePublica.length < 20
    ) {
      return c.json({ erro: "dados_invalidos" }, 400);
    }

    // Recusa aqui o que a confirmação recusaria lá na frente. Sem isto o
    // celular mostrava um código válido, a pessoa digitava no computador e só
    // então descobria que aquela chave nunca poderia ser aceita.
    const jaCadastrada = await buscarDispositivoPorChave(db, chavePublica);
    if (jaCadastrada) {
      const motivo = motivoChaveIndisponivel(jaCadastrada, sessao.usuarioId);
      if (motivo) return c.json({ erro: motivo }, 409);
    }

    const codigo = gerarCodigo();
    const momento = agora();

    const pedido = await criarPedidoPareamento(db, {
      usuarioId: sessao.usuarioId,
      codigoHash: hashDoToken(codigo),
      chavePublicaSolicitante: chavePublica,
      algoritmo,
      nomeSolicitante: nome.trim().slice(0, 100) || "Dispositivo",
      expiraEm: new Date(momento.getTime() + VALIDADE_PAREAMENTO_MS),
    });

    // O código só existe nesta resposta: o banco guarda apenas o hash.
    return c.json(
      {
        pedidoId: pedido.id,
        codigo,
        codigoFormatado: formatarCodigo(codigo),
        expiraEm: pedido.expiraEm,
      },
      201,
    );
  });

  /** Convite iniciado fisicamente no Agente e exibido como QR descartável. */
  app.post("/pareamento/convites", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const { nonce, chavePublicaAgente, assinatura } = (corpo ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof nonce !== "string" ||
      nonce.length < 16 ||
      nonce.length > 128 ||
      typeof chavePublicaAgente !== "string" ||
      typeof assinatura !== "string"
    ) {
      return c.json({ erro: "dados_invalidos" }, 400);
    }

    const agente = await buscarDispositivoAtivoPorChave(db, chavePublicaAgente);
    const autorizado =
      agente?.usuarioId === sessao.usuarioId &&
      agente.papel === "agent" &&
      (await verificar(
        agente.chavePublica,
        agente.algoritmo,
        mensagemCriacaoConviteQr({ nonce, chavePublicaAgente }),
        assinatura,
      ));
    if (!autorizado || !agente) return c.json({ erro: "agente_invalido" }, 401);

    const momento = agora();
    const token = criarTokenSessao(momento);
    const convite = await criarConvitePareamentoQr(db, {
      usuarioId: sessao.usuarioId,
      agenteId: agente.id,
      tokenHash: token.hash,
      expiraEm: new Date(momento.getTime() + VALIDADE_PAREAMENTO_MS),
    });
    const origemPwa =
      config.origensPermitidas.find((origem) => origem.startsWith("https://")) ??
      config.origensPermitidas[0] ??
      "http://localhost:4400";

    return c.json(
      {
        conviteId: convite.id,
        expiraEm: convite.expiraEm,
        // Fragmento não viaja ao servidor nem aparece em logs HTTP.
        url: `${origemPwa}/#convite=${encodeURIComponent(token.token)}`,
      },
      201,
    );
  });

  app.post("/pareamento/convites/visualizar", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const token = (corpo as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || token.length < 32 || token.length > 256) {
      return c.json({ erro: "convite_invalido" }, 400);
    }
    const convite = await buscarConvitePareamentoQrPorToken(
      db,
      sessao.usuarioId,
      hashDoToken(token),
      agora(),
    );
    if (!convite) return c.json({ erro: "convite_invalido" }, 404);
    const agente = await buscarDispositivoDaConta(db, sessao.usuarioId, convite.agenteId);
    if (!agente || agente.papel !== "agent") {
      return c.json({ erro: "agente_invalido" }, 409);
    }
    return c.json({
      conviteId: convite.id,
      expiraEm: convite.expiraEm,
      agente: { id: agente.id, nome: agente.nome },
    });
  });

  app.post("/pareamento/convites/aceitar", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const { token, chavePublica, algoritmo, nome } = (corpo ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof token !== "string" ||
      token.length < 32 ||
      token.length > 256 ||
      typeof chavePublica !== "string" ||
      chavePublica.length < 20 ||
      typeof algoritmo !== "string" ||
      typeof nome !== "string"
    ) {
      return c.json({ erro: "dados_invalidos" }, 400);
    }
    const momento = agora();
    const convite = await buscarConvitePareamentoQrPorToken(
      db,
      sessao.usuarioId,
      hashDoToken(token),
      momento,
    );
    if (!convite) return c.json({ erro: "convite_invalido" }, 404);
    const agente = await buscarDispositivoDaConta(db, sessao.usuarioId, convite.agenteId);
    if (!agente || agente.papel !== "agent") {
      return c.json({ erro: "agente_invalido" }, 409);
    }

    let superficie = await buscarDispositivoPorChave(db, chavePublica);
    if (superficie) {
      const motivo = motivoChaveIndisponivel(superficie, sessao.usuarioId);
      if (motivo) return c.json({ erro: motivo }, 409);
    } else {
      superficie = await criarDispositivo(db, {
        usuarioId: sessao.usuarioId,
        papel: "surface",
        nome: nome.trim().slice(0, 100) || "Dispositivo",
        chavePublica,
        algoritmo,
        escopos: ESCOPOS_PADRAO.join(" "),
      });
    }

    const aceito = await aceitarConvitePareamentoQr(
      db,
      convite.id,
      superficie.id,
      momento,
    );
    if (!aceito) return c.json({ erro: "convite_invalido" }, 409);

    return c.json({
      pareado: true,
      agente: {
        id: agente.id,
        nome: agente.nome,
        papel: "agent" as const,
        chavePublica: agente.chavePublica,
        algoritmo: agente.algoritmo,
        escopos: agente.escopos.split(" ").filter(Boolean),
      },
    });
  });

  app.get("/pareamento/convites/:id", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const conviteId = c.req.param("id");
    if (!conviteId) return c.json({ erro: "nao_encontrado" }, 404);
    const convite = await buscarConvitePareamentoQrPorId(
      db,
      sessao.usuarioId,
      conviteId,
    );
    if (!convite) return c.json({ erro: "nao_encontrado" }, 404);
    if (!convite.aceitoEm || !convite.superficieId) {
      return c.json({
        situacao: convite.expiraEm.getTime() > agora().getTime() ? "pendente" : "expirado",
      });
    }
    const superficie = await buscarDispositivoDaConta(
      db,
      sessao.usuarioId,
      convite.superficieId,
    );
    if (!superficie || superficie.papel !== "surface") {
      return c.json({ erro: "dispositivo_invalido" }, 409);
    }
    return c.json({
      situacao: "confirmado",
      dispositivo: {
        id: superficie.id,
        nome: superficie.nome,
        papel: superficie.papel,
        situacao: superficie.situacao,
        chavePublica: superficie.chavePublica,
        algoritmo: superficie.algoritmo,
        escopos: superficie.escopos.split(" ").filter(Boolean),
      },
    });
  });

  /** O Agente confirma, com o código que a pessoa digitou no computador. */
  app.post("/pareamento/confirmar", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const { codigo, chavePublicaAgente, assinatura } = (corpo ?? {}) as Record<
      string,
      unknown
    >;

    if (
      typeof codigo !== "string" ||
      typeof chavePublicaAgente !== "string" ||
      typeof assinatura !== "string"
    ) {
      return c.json({ erro: "codigo_invalido" }, 400);
    }

    const agente = await buscarDispositivoAtivoPorChave(db, chavePublicaAgente);
    const provaValida =
      agente?.usuarioId === sessao.usuarioId &&
      agente.papel === "agent" &&
      (await verificar(
        agente.chavePublica,
        agente.algoritmo,
        mensagemConfirmacaoPareamento({
          codigo,
          chavePublicaAgente,
        }),
        assinatura,
      ));

    if (!provaValida) return c.json({ erro: "agente_invalido" }, 401);

    const pedido = await buscarPedidoAtivo(db, sessao.usuarioId, agora());
    if (!pedido) {
      return c.json({ erro: "nenhum_pedido_ativo" }, 404);
    }

    const atualizado = await registrarTentativaPareamento(db, pedido.id);

    if (!comparacaoSegura(pedido.codigoHash, hashDoToken(codigo.trim()))) {
      const restantes = MAX_TENTATIVAS - atualizado.tentativas;

      if (restantes <= 0) {
        // Esgotadas as tentativas, o pedido inteiro morre. Recomeçar exige
        // código novo, o que devolve o espaço de busca ao tamanho original.
        await bloquearPedido(db, pedido.id);
        return c.json({ erro: "bloqueado", tentativasRestantes: 0 }, 429);
      }

      return c.json({ erro: "codigo_incorreto", tentativasRestantes: restantes }, 401);
    }

    let dispositivo = await buscarDispositivoPorChave(
      db,
      pedido.chavePublicaSolicitante,
    );
    if (dispositivo) {
      // Permite repetir a cerimônia física para recuperar a cópia local da
      // chave do Agente (por exemplo, após limpar os dados da PWA). Isso não
      // ressuscita dispositivo revogado nem move chave entre contas.
      const motivo = motivoChaveIndisponivel(dispositivo, sessao.usuarioId);
      if (motivo) return c.json({ erro: motivo }, 409);
    } else {
      try {
        dispositivo = await criarDispositivo(db, {
          usuarioId: sessao.usuarioId,
          papel: "surface",
          nome: pedido.nomeSolicitante,
          chavePublica: pedido.chavePublicaSolicitante,
          algoritmo: pedido.algoritmo,
          escopos: ESCOPOS_PADRAO.join(" "),
        });
      } catch {
        return c.json({ erro: "chave_ja_registrada" }, 409);
      }
    }

    await confirmarPedido(db, pedido.id, agente.id);

    return c.json({
      pareado: true,
      dispositivo: {
        id: dispositivo.id,
        nome: dispositivo.nome,
        papel: dispositivo.papel,
        situacao: dispositivo.situacao,
        chavePublica: dispositivo.chavePublica,
        algoritmo: dispositivo.algoritmo,
        escopos: dispositivo.escopos.split(" ").filter(Boolean),
      },
    });
  });

  /**
   * A superfície consulta o pedido específico que ela criou. Quando o Agente
   * confirma, esta resposta entrega a chave que será fixada no IndexedDB; a
   * lista geral de dispositivos nunca cria confiança.
   */
  app.get("/pareamento/pedidos/:id", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const pedidoId = c.req.param("id");
    if (!pedidoId) return c.json({ erro: "nao_encontrado" }, 404);
    const resultado = await buscarResultadoPedidoPareamento(
      db,
      sessao.usuarioId,
      pedidoId,
    );
    if (!resultado) return c.json({ erro: "nao_encontrado" }, 404);
    if (resultado.bloqueadoEm) return c.json({ situacao: "bloqueado" });
    if (!resultado.confirmadoEm) {
      return c.json({
        situacao: resultado.expiraEm.getTime() > agora().getTime() ? "pendente" : "expirado",
      });
    }
    if (
      !resultado.agenteId ||
      resultado.agentePapel !== "agent" ||
      resultado.agenteSituacao !== "ativo" ||
      !resultado.agenteChavePublica ||
      !resultado.agenteAlgoritmo
    ) {
      return c.json({ erro: "agente_invalido" }, 409);
    }
    return c.json({
      situacao: "confirmado",
      agente: {
        id: resultado.agenteId,
        nome: resultado.agenteNome ?? "Computador",
        papel: "agent" as const,
        chavePublica: resultado.agenteChavePublica,
        algoritmo: resultado.agenteAlgoritmo,
        escopos: (resultado.agenteEscopos ?? "").split(" ").filter(Boolean),
      },
    });
  });

  // ---- Autenticação da sinalização ------------------------------------

  /**
   * Emite um desafio para um dispositivo já pareado.
   *
   * Não exige cookie de conta: depois do pareamento, a chave do dispositivo é
   * a credencial. Isso permite que o Agente volte a conectar ao iniciar o
   * Windows sem pedir a senha da pessoa a cada reinicialização.
   */
  app.post("/sinalizacao/desafios", async (c) => {
    const corpo = await c.req.json().catch(() => null);
    const analise = pedidoDesafioSinalizacao.safeParse(corpo);
    if (!analise.success) return c.json({ erro: "dados_invalidos" }, 400);

    const resultado = await emitirDesafioSinalizacao(
      db,
      analise.data.chavePublica,
      agora(),
    );
    if (!resultado.ok) {
      return c.json(
        { erro: resultado.erro },
        resultado.erro === "limite_excedido" ? 429 : 404,
      );
    }

    return c.json(
      {
        desafioId: resultado.desafioId,
        dispositivoId: resultado.dispositivoId,
        nonce: resultado.nonce,
        expiraEm: resultado.expiraEm,
        urlSinalizacao: config.urlSinalizacao,
      },
      201,
    );
  });

  app.post("/sinalizacao/tokens", async (c) => {
    const corpo = await c.req.json().catch(() => null);
    const analise = provaDesafioSinalizacao.safeParse(corpo);
    if (!analise.success) return c.json({ erro: "dados_invalidos" }, 400);

    const resultado = await trocarDesafioPorToken(db, analise.data, agora());
    if (!resultado.ok) return c.json({ erro: resultado.erro }, 401);

    return c.json({ token: resultado.token, expiraEm: resultado.expiraEm }, 201);
  });

  app.notFound((c) => c.json({ erro: "nao_encontrado" }, 404));

  app.onError((erro, c) => {
    // O detalhe fica no log do servidor; a resposta não carrega nada que ajude
    // a mapear a infraestrutura.
    console.error("Erro não tratado:", erro);
    return c.json({ erro: "erro_interno" }, 500);
  });

  return app;
}

export { VALIDADE_MS };
