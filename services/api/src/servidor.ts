import { Hono, type Context, type Next } from "hono";
import type { Database } from "@slate/db";
import { ESCOPOS_PADRAO } from "@slate/protocol";
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
  bloquearPedido,
  buscarPedidoAtivo,
  buscarUsuarioPorEmail,
  confirmarPedido,
  contarTentativas,
  criarDispositivo,
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
}

export function criarServidor({ db, config, agora = () => new Date() }: Dependencias) {
  const app = new Hono<{ Variables: Variaveis }>();

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
        criadoEm: d.criadoEm,
        ultimoAcessoEm: d.ultimoAcessoEm,
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

  /** O Agente confirma, com o código que a pessoa digitou no computador. */
  app.post("/pareamento/confirmar", exigirSessao, async (c) => {
    const sessao = c.get("sessao");
    const corpo = await c.req.json().catch(() => null);
    const { codigo } = (corpo ?? {}) as Record<string, unknown>;

    if (typeof codigo !== "string") {
      return c.json({ erro: "codigo_invalido" }, 400);
    }

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

    let dispositivo;
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

    await confirmarPedido(db, pedido.id);

    return c.json({
      pareado: true,
      dispositivo: { id: dispositivo.id, nome: dispositivo.nome },
    });
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
