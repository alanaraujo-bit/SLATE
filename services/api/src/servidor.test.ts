import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Database } from "@slate/db";
import { usuarios } from "@slate/db/schema-contas";
import { ESCOPOS_PADRAO } from "@slate/protocol";
import { criarServidor, ehChaveDuplicada } from "./servidor";
import { NOME_COOKIE } from "./sessao";
import type { Config } from "./config";
import {
  assinar,
  gerarIdentidade,
  mensagemConfirmacaoPareamento,
  mensagemCriacaoConviteQr,
  type IdentidadeDispositivo,
} from "@slate/identidade";

/**
 * Testes dos endpoints, contra Postgres real.
 *
 * Verificam o que um cliente de verdade veria: código de resposta, cabeçalho
 * de cookie e corpo. As regras que importam aqui são de segurança — não vazar
 * quais e-mails têm conta, não aceitar requisição de outro site, não deixar
 * uma conta mexer no dispositivo de outra.
 */

const URL_BANCO = process.env.DATABASE_URL;
const suite = URL_BANCO ? describe : describe.skip;

const ORIGEM = "http://localhost:4400";

/*
 * Sem banco de propósito: o que quebrou aqui foi o *formato* do erro, e não o
 * comportamento do Postgres. Um teste que precisasse de `DATABASE_URL` se
 * pularia justamente onde a regressão passou.
 */
describe("reconhecimento de chave duplicada", () => {
  it("enxerga o código do Postgres embrulhado pelo Drizzle", () => {
    // O Drizzle deixou de entregar o `PostgresError` cru: ele o embrulha e
    // pendura o original em `cause`. Enquanto esta função olhava só o topo, o
    // Agente recebia 500 no lugar do 409 que ele trata como "já registrado" —
    // e ninguém conseguia entrar na conta a partir da segunda execução.
    const original = Object.assign(new Error("duplicate key"), { code: "23505" });
    const embrulhado = Object.assign(new Error("Failed query"), { cause: original });

    expect(ehChaveDuplicada(original)).toBe(true);
    expect(ehChaveDuplicada(embrulhado)).toBe(true);
    expect(ehChaveDuplicada({ cause: { cause: original } })).toBe(true);
  });

  it("não confunde outra falha de escrita com duplicidade", () => {
    // Confundir aqui devolveria "esta chave já está registrada" para uma
    // conexão caída, e quem lesse iria procurar um cadastro que não existe.
    expect(ehChaveDuplicada(new Error("conexão encerrada"))).toBe(false);
    expect(ehChaveDuplicada({ code: "23503" })).toBe(false);
    expect(ehChaveDuplicada(null)).toBe(false);
    expect(ehChaveDuplicada(undefined)).toBe(false);
  });

  it("não entra em laço com uma cadeia de causas circular", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(ehChaveDuplicada(a)).toBe(false);
  });
});

suite("API de contas", () => {
  let db: Database;
  let app: ReturnType<typeof criarServidor>;
  const criados: string[] = [];

  const config: Config = {
    producao: false,
    porta: 4500,
    databaseUrl: URL_BANCO ?? "",
    origensPermitidas: [ORIGEM],
    cookieSeguro: false,
    urlSinalizacao: "ws://localhost:4500/sinalizacao",
  };

  const emailUnico = (rotulo: string) =>
    `api-${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`;

  const SENHA = "cavalo-bateria-grampo";

  /** Cadastra e devolve o cookie de sessão. */
  const cadastrar = async (email: string) => {
    const resposta = await app.request("/contas/cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGEM },
      body: JSON.stringify({ email, senha: SENHA, nome: "Teste" }),
    });

    const corpo = await resposta.json();
    if (corpo.usuario?.id) criados.push(corpo.usuario.id);

    return {
      resposta,
      corpo,
      cookie: extrairCookie(resposta.headers.get("Set-Cookie")),
    };
  };

  const extrairCookie = (cabecalho: string | null) => {
    if (!cabecalho) return "";
    const valor = cabecalho.split(";")[0];
    return valor ?? "";
  };

  beforeAll(() => {
    db = createDb(URL_BANCO!);
    app = criarServidor({ db, config });
  });

  afterAll(async () => {
    for (const id of criados) {
      await db.delete(usuarios).where(eq(usuarios.id, id));
    }
  });

  describe("saúde", () => {
    it("responde quando o banco está acessível", async () => {
      const resposta = await app.request("/saude");
      expect(resposta.status).toBe(200);
      expect((await resposta.json()).situacao).toBe("ok");
    });
  });

  describe("cadastro", () => {
    it("cria a conta e já entrega a sessão", async () => {
      const { resposta, cookie } = await cadastrar(emailUnico("novo"));
      expect(resposta.status).toBe(201);
      expect(cookie).toContain(NOME_COOKIE);
    });

    it("o cookie da sessão é inacessível a script", async () => {
      const { resposta } = await cadastrar(emailUnico("httponly"));
      expect(resposta.headers.get("Set-Cookie")).toContain("HttpOnly");
    });

    it("recusa e-mail inválido", async () => {
      const resposta = await app.request("/contas/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email: "sem-arroba", senha: SENHA }),
      });
      expect(resposta.status).toBe(400);
    });

    it("recusa senha fraca explicando o motivo", async () => {
      const resposta = await app.request("/contas/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email: emailUnico("fraca"), senha: "123" }),
      });

      expect(resposta.status).toBe(400);
      const corpo = await resposta.json();
      expect(corpo.erro).toBe("senha_fraca");
      expect(corpo.problemas.length).toBeGreaterThan(0);
    });

    it("não revela que um e-mail já está cadastrado", async () => {
      // Responder diferente aqui entregaria quais endereços têm conta — o
      // passo anterior a tentar senhas.
      const email = emailUnico("repetido");
      await cadastrar(email);

      const segunda = await app.request("/contas/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email, senha: "outra-senha-valida" }),
      });

      expect(segunda.status).toBe(201);
      // Mas não entrega sessão: quem já tem conta precisa entrar com a senha.
      expect(segunda.headers.get("Set-Cookie")).toBeNull();
    });

    it("recusa corpo que não é objeto", async () => {
      const resposta = await app.request("/contas/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: "isso-nao-e-json",
      });
      expect(resposta.status).toBe(400);
    });
  });

  describe("entrada", () => {
    it("aceita as credenciais corretas", async () => {
      const email = emailUnico("entra");
      await cadastrar(email);

      const resposta = await app.request("/contas/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email, senha: SENHA }),
      });

      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("Set-Cookie")).toContain(NOME_COOKIE);
    });

    it("gera uma sessão nova a cada entrada", async () => {
      // Fecha fixação de sessão, em que alguém planta um token conhecido antes
      // do login.
      const email = emailUnico("rotaciona");
      const primeira = await cadastrar(email);

      const segunda = await app.request("/contas/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email, senha: SENHA }),
      });

      expect(extrairCookie(segunda.headers.get("Set-Cookie"))).not.toBe(primeira.cookie);
    });

    it("recusa a senha errada", async () => {
      const email = emailUnico("senha-errada");
      await cadastrar(email);

      const resposta = await app.request("/contas/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email, senha: "senha-completamente-errada" }),
      });

      expect(resposta.status).toBe(401);
    });

    it("responde igual para e-mail inexistente e senha errada", async () => {
      // A diferença entre as duas respostas é o que permite descobrir contas.
      const email = emailUnico("existe");
      await cadastrar(email);

      const senhaErrada = await app.request("/contas/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email, senha: "errada-mas-valida" }),
      });

      const naoExiste = await app.request("/contas/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({ email: emailUnico("fantasma"), senha: "errada-mas-valida" }),
      });

      expect(naoExiste.status).toBe(senhaErrada.status);
      expect(await naoExiste.json()).toEqual(await senhaErrada.json());
    });
  });

  describe("sessão", () => {
    it("identifica quem está autenticado", async () => {
      const email = emailUnico("eu");
      const { cookie } = await cadastrar(email);

      const resposta = await app.request("/contas/eu", { headers: { Cookie: cookie } });

      expect(resposta.status).toBe(200);
      expect((await resposta.json()).usuario.email).toBe(email);
    });

    it("recusa sem cookie", async () => {
      expect((await app.request("/contas/eu")).status).toBe(401);
    });

    it("recusa cookie inventado", async () => {
      const resposta = await app.request("/contas/eu", {
        headers: { Cookie: `${NOME_COOKIE}=token-falso` },
      });
      expect(resposta.status).toBe(401);
    });

    it("sair invalida a sessão de verdade", async () => {
      const { cookie } = await cadastrar(emailUnico("sai"));

      await app.request("/contas/saida", {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGEM },
      });

      expect((await app.request("/contas/eu", { headers: { Cookie: cookie } })).status).toBe(
        401,
      );
    });

    it("sair apaga o cookie no navegador", async () => {
      const { cookie } = await cadastrar(emailUnico("apaga"));

      const resposta = await app.request("/contas/saida", {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGEM },
      });

      expect(resposta.headers.get("Set-Cookie")).toContain("Max-Age=0");
    });

    it("sair funciona mesmo sem sessão válida", async () => {
      // Quem pediu para sair precisa sair, mesmo que a sessão já tenha
      // expirado — senão a pessoa fica presa numa tela que não responde.
      const resposta = await app.request("/contas/saida", {
        method: "POST",
        headers: { Origin: ORIGEM },
      });
      expect(resposta.status).toBe(200);
    });
  });

  describe("origem", () => {
    it("recusa requisição que altera estado vinda de outro site", async () => {
      const resposta = await app.request("/contas/entrada", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://site-malicioso.com",
        },
        body: JSON.stringify({ email: "a@b.co", senha: SENHA }),
      });

      expect(resposta.status).toBe(403);
    });

    it("recusa origem que apenas parece a permitida", async () => {
      // O erro clássico de verificar por sufixo.
      const resposta = await app.request("/contas/entrada", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:4400.site-malicioso.com",
        },
        body: JSON.stringify({ email: "a@b.co", senha: SENHA }),
      });

      expect(resposta.status).toBe(403);
    });

    it("aceita requisição sem Origin, que vem de cliente não navegador", async () => {
      // É o caso do Agente Desktop.
      const resposta = await app.request("/contas/saida", { method: "POST" });
      expect(resposta.status).toBe(200);
    });

    it("devolve a origem exata, nunca curinga", async () => {
      const resposta = await app.request("/saude", { headers: { Origin: ORIGEM } });
      expect(resposta.headers.get("Access-Control-Allow-Origin")).toBe(ORIGEM);
      expect(resposta.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("varia a resposta por origem, para não ser servida de cache errado", async () => {
      const resposta = await app.request("/saude", { headers: { Origin: ORIGEM } });
      expect(resposta.headers.get("Vary")).toContain("Origin");
    });
  });

  describe("dispositivos", () => {
    it("lista vazia para conta nova", async () => {
      const { cookie } = await cadastrar(emailUnico("lista"));
      const resposta = await app.request("/dispositivos", { headers: { Cookie: cookie } });

      expect(resposta.status).toBe(200);
      expect((await resposta.json()).dispositivos).toEqual([]);
    });

    it("registra o Agente sem exigir código", async () => {
      // Estar no computador já é prova de posse da máquina.
      const { cookie } = await cadastrar(emailUnico("agente"));

      const resposta = await app.request("/dispositivos/agente", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify({
          chavePublica: `chave-agente-${Date.now()}-${Math.random()}`,
          algoritmo: "Ed25519",
          nome: "PC do Alan",
        }),
      });

      expect(resposta.status).toBe(201);
    });

    it("o dispositivo nasce sem escopo perigoso", async () => {
      const { cookie } = await cadastrar(emailUnico("escopo"));

      await app.request("/dispositivos/agente", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify({
          chavePublica: `chave-escopo-${Date.now()}-${Math.random()}`,
          algoritmo: "Ed25519",
          nome: "PC",
        }),
      });

      const lista = await (
        await app.request("/dispositivos", { headers: { Cookie: cookie } })
      ).json();

      expect(lista.dispositivos[0].escopos).not.toContain("system.shell");
      expect(lista.dispositivos[0].escopos).not.toContain("action.define");
    });

    it("uma conta não enxerga dispositivo de outra", async () => {
      const dono = await cadastrar(emailUnico("dono"));
      const estranho = await cadastrar(emailUnico("estranho"));

      await app.request("/dispositivos/agente", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: dono.cookie,
          Origin: ORIGEM,
        },
        body: JSON.stringify({
          chavePublica: `chave-privada-${Date.now()}-${Math.random()}`,
          algoritmo: "Ed25519",
          nome: "PC do dono",
        }),
      });

      const lista = await (
        await app.request("/dispositivos", { headers: { Cookie: estranho.cookie } })
      ).json();

      expect(lista.dispositivos).toEqual([]);
    });

    it("uma conta não revoga dispositivo de outra", async () => {
      const dono = await cadastrar(emailUnico("dono2"));
      const estranho = await cadastrar(emailUnico("estranho2"));

      const criado = await (
        await app.request("/dispositivos/agente", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: dono.cookie,
            Origin: ORIGEM,
          },
          body: JSON.stringify({
            chavePublica: `chave-alheia-${Date.now()}-${Math.random()}`,
            algoritmo: "Ed25519",
            nome: "PC",
          }),
        })
      ).json();

      const resposta = await app.request(`/dispositivos/${criado.dispositivo.id}`, {
        method: "DELETE",
        headers: { Cookie: estranho.cookie, Origin: ORIGEM },
      });

      expect(resposta.status).toBe(404);
    });
  });

  describe("pareamento", () => {
    const chaveNova = () => `chave-par-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const pedirPareamento = async (cookie: string, chavePublica = chaveNova()) => {
      const resposta = await app.request("/pareamento/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify({
          chavePublica,
          algoritmo: "Ed25519",
          nome: "Celular do Alan",
        }),
      });
      return { resposta, corpo: await resposta.json() };
    };

    const registrarAgente = async (cookie: string) => {
      const identidade = await gerarIdentidade();
      const resposta = await app.request("/dispositivos/agente", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify({
          chavePublica: identidade.chavePublicaExportada,
          algoritmo: identidade.algoritmo,
          nome: "PC de teste",
        }),
      });
      expect(resposta.status).toBe(201);
      return identidade;
    };

    const provaDoAgente = async (
      codigo: string,
      identidade: IdentidadeDispositivo,
    ) => ({
      codigo,
      chavePublicaAgente: identidade.chavePublicaExportada,
      assinatura: await assinar(
        identidade,
        mensagemConfirmacaoPareamento({
          codigo,
          chavePublicaAgente: identidade.chavePublicaExportada,
        }),
      ),
    });

    const criarConviteQr = async (
      cookie: string,
      identidade: IdentidadeDispositivo,
    ) => {
      const nonce = crypto.randomUUID();
      const chavePublicaAgente = identidade.chavePublicaExportada;
      return app.request("/pareamento/convites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify({
          nonce,
          chavePublicaAgente,
          assinatura: await assinar(
            identidade,
            mensagemCriacaoConviteQr({ nonce, chavePublicaAgente }),
          ),
        }),
      });
    };

    it("o pedido devolve um código de seis dígitos", async () => {
      const { cookie } = await cadastrar(emailUnico("pede"));
      const { resposta, corpo } = await pedirPareamento(cookie);

      expect(resposta.status).toBe(201);
      expect(corpo.codigo).toMatch(/^\d{6}$/);
      expect(corpo.codigoFormatado).toMatch(/^\d{3} \d{3}$/);
    });

    it("o código certo conclui o pareamento", async () => {
      const { cookie } = await cadastrar(emailUnico("confirma"));
      const agente = await registrarAgente(cookie);
      const { corpo } = await pedirPareamento(cookie);

      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente(corpo.codigo, agente)),
      });

      expect(resposta.status).toBe(200);
      expect((await resposta.json()).pareado).toBe(true);
    });

    it("o código mais recente vence o pedido anterior da mesma conta", async () => {
      // O celular pode deixar pedidos abertos para trás — cancelar na tela não
      // avisa o servidor. Antes, a confirmação pegava um pedido qualquer entre
      // os abertos, e o código certo era comparado com o de outro: dava "código
      // incorreto" com o código correto na tela, até esgotar as tentativas.
      const { cookie } = await cadastrar(emailUnico("dois-pedidos"));
      const agente = await registrarAgente(cookie);
      const chave = chaveNova();

      const primeiro = await pedirPareamento(cookie, chave);
      const segundo = await pedirPareamento(cookie, chave);
      expect(segundo.corpo.codigo).not.toBe(primeiro.corpo.codigo);

      // Verificado antes de qualquer confirmação, e de propósito: só a ordem
      // da consulta já faria o código novo vencer, e este teste passaria sem
      // que o pedido antigo tivesse morrido de verdade. É aqui que se vê que
      // ele morreu — e é isto que o celular parado na tela antiga lê.
      const antigo = await app.request(
        `/pareamento/pedidos/${primeiro.corpo.pedidoId}`,
        { headers: { Cookie: cookie } },
      );
      expect((await antigo.json()).situacao).toBe("expirado");

      const confirmar = async (codigo: string) =>
        app.request("/pareamento/confirmar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
          body: JSON.stringify(await provaDoAgente(codigo, agente)),
        });

      // O código antigo já não vale — vira tentativa errada do pedido atual,
      // que é exatamente o que ele é.
      expect((await confirmar(primeiro.corpo.codigo)).status).toBe(401);
      expect((await confirmar(segundo.corpo.codigo)).status).toBe(200);
    });

    it("o QR pareia, entrega as duas chaves e não pode ser repetido", async () => {
      const { cookie } = await cadastrar(emailUnico("qr"));
      const agente = await registrarAgente(cookie);
      const respostaConvite = await criarConviteQr(cookie, agente);
      expect(respostaConvite.status).toBe(201);
      const convite = await respostaConvite.json();
      const url = new URL(convite.url);
      expect(url.search).toBe("");
      const token = new URLSearchParams(url.hash.slice(1)).get("convite");
      expect(token).toHaveLength(43);

      const previa = await app.request("/pareamento/convites/visualizar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify({ token }),
      });
      expect(previa.status).toBe(200);
      expect((await previa.json()).agente.nome).toBe("PC de teste");

      const superficie = await gerarIdentidade();
      const aceitar = () =>
        app.request("/pareamento/convites/aceitar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
          body: JSON.stringify({
            token,
            chavePublica: superficie.chavePublicaExportada,
            algoritmo: superficie.algoritmo,
            nome: "iPhone por QR",
          }),
        });
      const primeira = await aceitar();
      expect(primeira.status).toBe(200);
      expect((await primeira.json()).agente.chavePublica).toBe(
        agente.chavePublicaExportada,
      );

      const resultado = await app.request(`/pareamento/convites/${convite.conviteId}`, {
        headers: { Cookie: cookie },
      });
      expect((await resultado.json()).dispositivo.nome).toBe("iPhone por QR");
      expect((await aceitar()).status).toBe(404);
    }, 15_000);

    it("o QR também reativa um aparelho removido, e não só o código", async () => {
      /*
       * O laço que este teste tranca, e que só aparece no aparelho de verdade:
       * a leitura do QR mostrava o computador certo, a pessoa aprovava, a API
       * respondia `pareado: true` — e a tela pedia o QR de novo, sem fim.
       *
       * A superfície continuava revogada. `motivoChaveIndisponivel` deixa
       * revogado passar de propósito, e quem concluía o trabalho era a
       * confirmação por código, com `reativarDispositivo`. O caminho do QR
       * nasceu depois e não recebeu a mesma reativação, então ele aceitava o
       * convite e deixava o aparelho inativo — e a PWA, que só considera
       * aparelho ativo, mandava parear outra vez.
       */
      const { cookie } = await cadastrar(emailUnico("qr-revogado"));
      const agente = await registrarAgente(cookie);
      const celular = await gerarIdentidade();

      const listarSuperficies = async () =>
        (
          await (
            await app.request("/dispositivos", { headers: { Cookie: cookie, Origin: ORIGEM } })
          ).json()
        ).dispositivos.filter((d: { papel: string }) => d.papel === "surface");

      /** Lê o QR com a chave que este aparelho guardou — sempre a mesma. */
      const parearPorQr = async (nome: string) => {
        const convite = await (await criarConviteQr(cookie, agente)).json();
        const token = new URLSearchParams(new URL(convite.url).hash.slice(1)).get("convite");
        return app.request("/pareamento/convites/aceitar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
          body: JSON.stringify({
            token,
            chavePublica: celular.chavePublicaExportada,
            algoritmo: celular.algoritmo,
            nome,
          }),
        });
      };

      expect((await parearPorQr("iPhone")).status).toBe(200);
      const [primeira] = await listarSuperficies();

      await app.request(`/dispositivos/${primeira.id}`, {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: ORIGEM },
      });

      expect((await parearPorQr("iPhone de volta")).status).toBe(200);

      const superficies = await listarSuperficies();

      // Ativo: é o que a PWA exige para sair da tela de pareamento. Enquanto
      // ficava revogado, `pareado: true` era uma resposta que não pareava.
      expect(superficies).toHaveLength(1);
      expect(superficies[0].situacao).toBe("ativo");
      // Mesma linha: reparear não pode encher a conta de cópias do aparelho.
      expect(superficies[0].id).toBe(primeira.id);
      expect(superficies[0].escopos).toEqual([...ESCOPOS_PADRAO]);
    }, 20_000);

    it("uma conta diferente não consegue visualizar o QR", async () => {
      const dono = await cadastrar(emailUnico("qr-dono"));
      const estranho = await cadastrar(emailUnico("qr-estranho"));
      const agente = await registrarAgente(dono.cookie);
      const convite = await (await criarConviteQr(dono.cookie, agente)).json();
      const token = new URLSearchParams(new URL(convite.url).hash.slice(1)).get("convite");
      const resposta = await app.request("/pareamento/convites/visualizar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: estranho.cookie,
          Origin: ORIGEM,
        },
        body: JSON.stringify({ token }),
      });
      expect(resposta.status).toBe(404);
    });

    it("o dispositivo pareado aparece na lista", async () => {
      const { cookie } = await cadastrar(emailUnico("aparece"));
      const agente = await registrarAgente(cookie);
      const { corpo } = await pedirPareamento(cookie);

      await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente(corpo.codigo, agente)),
      });

      const lista = await (
        await app.request("/dispositivos", { headers: { Cookie: cookie } })
      ).json();

      expect(lista.dispositivos).toHaveLength(2);
      const superficie = lista.dispositivos.find(
        (dispositivo: { papel: string }) => dispositivo.papel === "surface",
      );
      expect(superficie.nome).toBe("Celular do Alan");
    });

    /** Pareia um celular e devolve a chave dele e o id na conta. */
    const parearCelular = async (cookie: string, agente: IdentidadeDispositivo) => {
      const chavePublica = chaveNova();
      const { corpo } = await pedirPareamento(cookie, chavePublica);
      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente(corpo.codigo, agente)),
      });
      expect(resposta.status).toBe(200);
      return { chavePublica, id: (await resposta.json()).dispositivo.id as string };
    };

    it("um aparelho removido volta pela mesma linha, sem virar cópia", async () => {
      // O beco sem saída que este teste tranca: recusar a chave revogada não
      // protegia nada — reparear exige a mesma cerimônia física de um
      // pareamento novo — e prendia o aparelho, porque o celular reusa a chave
      // que guardou e "peça o pareamento de novo" devolvia a mesma recusa
      // para sempre.
      const { cookie } = await cadastrar(emailUnico("revogado"));
      const agente = await registrarAgente(cookie);
      const celular = await parearCelular(cookie, agente);

      await app.request(`/dispositivos/${celular.id}`, {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: ORIGEM },
      });

      // Repareia com a MESMA chave, sem trocar de identidade.
      const { corpo: pedido } = await pedirPareamento(cookie, celular.chavePublica);
      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente(pedido.codigo, agente)),
      });
      expect(resposta.status).toBe(200);

      const devolvido = (await resposta.json()).dispositivo;
      expect(devolvido.situacao).toBe("ativo");
      // Mesma linha, e não uma nova: é o que impede a conta de acumular cópias
      // do mesmo celular a cada repareamento.
      expect(devolvido.id).toBe(celular.id);

      const lista = await app.request("/dispositivos", {
        headers: { Cookie: cookie, Origin: ORIGEM },
      });
      const superficies = (await lista.json()).dispositivos.filter(
        (d: { papel: string }) => d.papel === "surface",
      );
      expect(superficies).toHaveLength(1);
      // Escopos voltam ao padrão: revogar foi retirada deliberada de
      // confiança, e o que fora concedido além disso não volta sozinho.
      expect(superficies[0].escopos).toEqual([...ESCOPOS_PADRAO]);
    }, 20_000);

    it("a chave de outra conta é recusada com motivo próprio", async () => {
      // Motivo diferente porque a saída é outra: identidade nova resolve o
      // aparelho revogado, mas não desfaz o cadastro em outra conta.
      const dono = await cadastrar(emailUnico("chave-dono"));
      const outro = await cadastrar(emailUnico("chave-outro"));
      const agente = await registrarAgente(dono.cookie);
      const celular = await parearCelular(dono.cookie, agente);

      const { resposta, corpo } = await pedirPareamento(
        outro.cookie,
        celular.chavePublica,
      );
      expect(resposta.status).toBe(409);
      expect(corpo.erro).toBe("chave_de_outra_conta");
    }, 15_000);

    it("o código errado é recusado e desconta tentativa", async () => {
      const { cookie } = await cadastrar(emailUnico("errado"));
      const agente = await registrarAgente(cookie);
      await pedirPareamento(cookie);

      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente("000000", agente)),
      });

      expect(resposta.status).toBe(401);
      expect((await resposta.json()).tentativasRestantes).toBe(2);
    });

    it("esgotar as tentativas bloqueia o pedido inteiro", async () => {
      // Recomeçar passa a exigir código novo, o que devolve o espaço de busca
      // ao tamanho original.
      const { cookie } = await cadastrar(emailUnico("bloqueia"));
      const agente = await registrarAgente(cookie);
      const { corpo } = await pedirPareamento(cookie);

      for (let i = 0; i < 3; i++) {
        await app.request("/pareamento/confirmar", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
          body: JSON.stringify(await provaDoAgente("000000", agente)),
        });
      }

      // Mesmo o código certo passa a ser recusado.
      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente(corpo.codigo, agente)),
      });

      expect(resposta.status).toBe(404);
    }, 15_000);

    it("não é possível confirmar sem um pedido em aberto", async () => {
      const { cookie } = await cadastrar(emailUnico("sem-pedido"));
      const agente = await registrarAgente(cookie);

      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGEM },
        body: JSON.stringify(await provaDoAgente("123456", agente)),
      });

      expect(resposta.status).toBe(404);
    });

    it("o código de uma conta não serve em outra", async () => {
      // O pedido é buscado pela conta da sessão, então o código de terceiros
      // simplesmente não encontra pedido.
      const alvo = await cadastrar(emailUnico("alvo"));
      const atacante = await cadastrar(emailUnico("atacante"));
      const agenteAtacante = await registrarAgente(atacante.cookie);

      const { corpo } = await pedirPareamento(alvo.cookie);

      const resposta = await app.request("/pareamento/confirmar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: atacante.cookie,
          Origin: ORIGEM,
        },
        body: JSON.stringify(await provaDoAgente(corpo.codigo, agenteAtacante)),
      });

      expect(resposta.status).toBe(404);
    });

    it("pedir pareamento exige estar autenticado", async () => {
      const resposta = await app.request("/pareamento/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGEM },
        body: JSON.stringify({
          chavePublica: chaveNova(),
          algoritmo: "Ed25519",
          nome: "Invasor",
        }),
      });

      expect(resposta.status).toBe(401);
    });
  });

  describe("rotas desconhecidas", () => {
    it("respondem 404 em JSON, e não em HTML", async () => {
      const resposta = await app.request("/rota/que/nao/existe");
      expect(resposta.status).toBe(404);
      expect((await resposta.json()).erro).toBe("nao_encontrado");
    });
  });
});
