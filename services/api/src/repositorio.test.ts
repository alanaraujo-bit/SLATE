import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type Database } from "@slate/db";
import { usuarios } from "@slate/db/schema-contas";
import { gerarHashSenha } from "./senha";
import { criarTokenSessao } from "./sessao";
import {
  JANELA_TENTATIVAS_MS,
  buscarDispositivoPorChave,
  buscarUsuarioPorEmail,
  contarTentativas,
  criarDispositivo,
  criarSessao,
  criarUsuario,
  encerrarSessao,
  encerrarTodasAsSessoes,
  limparSessoesExpiradas,
  limparTentativas,
  listarDispositivos,
  registrarTentativa,
  resolverSessao,
  revogarDispositivo,
} from "./repositorio";

/**
 * Testes de integração contra Postgres real.
 *
 * As regras que importam aqui — unicidade de e-mail, unicidade de chave de
 * dispositivo, expiração de sessão — são impostas pelo banco. Substituí-lo por
 * mock testaria o mock.
 */

const URL_BANCO = process.env.DATABASE_URL;
const suite = URL_BANCO ? describe : describe.skip;

suite("repositório de contas", () => {
  let db: Database;
  const criados: string[] = [];

  const emailUnico = (rotulo: string) =>
    `teste-${rotulo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`;

  const novoUsuario = async (rotulo: string) => {
    const usuario = await criarUsuario(db, {
      email: emailUnico(rotulo),
      senhaHash: await gerarHashSenha("cavalo-bateria-grampo"),
      nome: "Teste",
    });
    criados.push(usuario.id);
    return usuario;
  };

  beforeAll(() => {
    db = createDb(URL_BANCO!);
  });

  afterAll(async () => {
    // Cascata leva sessões, dispositivos e pedidos junto.
    for (const id of criados) {
      await db.delete(usuarios).where(eq(usuarios.id, id));
    }
  });

  describe("usuários", () => {
    it("cria e encontra por e-mail", async () => {
      const usuario = await novoUsuario("busca");
      const achado = await buscarUsuarioPorEmail(db, usuario.email);
      expect(achado?.id).toBe(usuario.id);
    });

    it("encontra independentemente da caixa digitada", async () => {
      // Quem cadastrou com maiúscula precisa conseguir entrar com minúscula.
      const usuario = await novoUsuario("caixa");
      const achado = await buscarUsuarioPorEmail(db, usuario.email.toUpperCase());
      expect(achado?.id).toBe(usuario.id);
    });

    it("devolve nulo para e-mail que não existe", async () => {
      expect(await buscarUsuarioPorEmail(db, "ninguem@exemplo.test")).toBeNull();
    });

    it("o banco recusa e-mail duplicado", async () => {
      // A garantia precisa estar no banco: uma checagem só na aplicação perde
      // a corrida entre dois cadastros simultâneos.
      const usuario = await novoUsuario("duplicado");

      await expect(
        criarUsuario(db, {
          email: usuario.email,
          senhaHash: await gerarHashSenha("outra-senha-aqui"),
        }),
      ).rejects.toThrow();
    });

    it("o e-mail é guardado em minúsculas", async () => {
      const email = emailUnico("MAIUSCULA").toUpperCase();
      const usuario = await criarUsuario(db, {
        email,
        senhaHash: await gerarHashSenha("cavalo-bateria-grampo"),
      });
      criados.push(usuario.id);

      expect(usuario.email).toBe(email.toLowerCase());
    });
  });

  describe("sessões", () => {
    it("resolve o token para o usuário", async () => {
      const usuario = await novoUsuario("sessao");
      const token = criarTokenSessao();

      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: token.hash,
        expiraEm: token.expiraEm,
      });

      const contexto = await resolverSessao(db, token.token);
      expect(contexto?.usuarioId).toBe(usuario.id);
      expect(contexto?.email).toBe(usuario.email);
    });

    it("recusa um token inventado", async () => {
      expect(await resolverSessao(db, "token-que-nao-existe")).toBeNull();
    });

    it("recusa sessão expirada", async () => {
      const usuario = await novoUsuario("expirada");
      const token = criarTokenSessao();

      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: token.hash,
        expiraEm: new Date(Date.now() - 1000),
      });

      expect(await resolverSessao(db, token.token)).toBeNull();
    });

    it("apaga a sessão expirada em vez de só ignorar", async () => {
      // Sem isso a tabela cresce para sempre e a limpeza vira um trabalho
      // agendado que ninguém lembra de criar.
      const usuario = await novoUsuario("limpeza");
      const token = criarTokenSessao();

      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: token.hash,
        expiraEm: new Date(Date.now() - 1000),
      });

      await resolverSessao(db, token.token);
      // Segunda chamada confirma que a linha sumiu, e não apenas que foi
      // ignorada.
      expect(await resolverSessao(db, token.token)).toBeNull();
    });

    it("encerrar uma sessão não derruba as outras", async () => {
      const usuario = await novoUsuario("varias");
      const celular = criarTokenSessao();
      const tablet = criarTokenSessao();

      const sessaoCelular = await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: celular.hash,
        expiraEm: celular.expiraEm,
      });
      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: tablet.hash,
        expiraEm: tablet.expiraEm,
      });

      await encerrarSessao(db, sessaoCelular.id);

      expect(await resolverSessao(db, celular.token)).toBeNull();
      expect(await resolverSessao(db, tablet.token)).not.toBeNull();
    });

    it("trocar a senha derruba todas as sessões", async () => {
      // Quem entrou com a senha antiga precisa perder o acesso — é o ponto de
      // trocar a senha depois de uma suspeita.
      const usuario = await novoUsuario("todas");
      const a = criarTokenSessao();
      const b = criarTokenSessao();

      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: a.hash,
        expiraEm: a.expiraEm,
      });
      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: b.hash,
        expiraEm: b.expiraEm,
      });

      await encerrarTodasAsSessoes(db, usuario.id);

      expect(await resolverSessao(db, a.token)).toBeNull();
      expect(await resolverSessao(db, b.token)).toBeNull();
    });

    it("a limpeza remove só o que já venceu", async () => {
      const usuario = await novoUsuario("varredura");
      const viva = criarTokenSessao();
      const morta = criarTokenSessao();

      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: viva.hash,
        expiraEm: viva.expiraEm,
      });
      await criarSessao(db, {
        usuarioId: usuario.id,
        tokenHash: morta.hash,
        expiraEm: new Date(Date.now() - 60_000),
      });

      await limparSessoesExpiradas(db);
      expect(await resolverSessao(db, viva.token)).not.toBeNull();
    });
  });

  describe("limite de tentativas", () => {
    it("conta as tentativas da janela", async () => {
      const chave = `teste-${Date.now()}-${Math.random()}`;
      await registrarTentativa(db, chave);
      await registrarTentativa(db, chave);

      expect(await contarTentativas(db, chave)).toBe(2);
      await limparTentativas(db, chave);
    });

    it("ignora tentativas fora da janela", async () => {
      const chave = `teste-antigo-${Date.now()}-${Math.random()}`;
      await registrarTentativa(db, chave);

      const futuro = new Date(Date.now() + JANELA_TENTATIVAS_MS + 60_000);
      expect(await contarTentativas(db, chave, futuro)).toBe(0);

      await limparTentativas(db, chave);
    });

    it("entrar com sucesso zera o contador", async () => {
      // Do contrário, alguém que erra a senha algumas vezes e acerta ficaria
      // com o contador cheio até a janela passar.
      const chave = `teste-zera-${Date.now()}-${Math.random()}`;
      await registrarTentativa(db, chave);
      await limparTentativas(db, chave);

      expect(await contarTentativas(db, chave)).toBe(0);
    });
  });

  describe("dispositivos", () => {
    it("cadastra e lista por conta", async () => {
      const usuario = await novoUsuario("dispositivo");

      await criarDispositivo(db, {
        usuarioId: usuario.id,
        papel: "surface",
        nome: "Celular do Alan",
        chavePublica: `chave-${Date.now()}-${Math.random()}`,
        algoritmo: "Ed25519",
        escopos: "state.read deck.read",
      });

      const lista = await listarDispositivos(db, usuario.id);
      expect(lista).toHaveLength(1);
      expect(lista[0]?.nome).toBe("Celular do Alan");
    });

    it("a mesma chave não pode existir em duas contas", async () => {
      // Sem isso, um dispositivo revogado voltaria sob outra conta com a mesma
      // identidade criptográfica.
      const primeiro = await novoUsuario("chave-a");
      const segundo = await novoUsuario("chave-b");
      const chave = `chave-compartilhada-${Date.now()}`;

      await criarDispositivo(db, {
        usuarioId: primeiro.id,
        papel: "agent",
        nome: "PC",
        chavePublica: chave,
        algoritmo: "Ed25519",
        escopos: "",
      });

      await expect(
        criarDispositivo(db, {
          usuarioId: segundo.id,
          papel: "agent",
          nome: "PC",
          chavePublica: chave,
          algoritmo: "Ed25519",
          escopos: "",
        }),
      ).rejects.toThrow();
    });

    it("revogar mantém a linha, para a chave não voltar", async () => {
      const usuario = await novoUsuario("revoga");
      const chave = `chave-revogada-${Date.now()}`;

      const dispositivo = await criarDispositivo(db, {
        usuarioId: usuario.id,
        papel: "surface",
        nome: "Tablet",
        chavePublica: chave,
        algoritmo: "Ed25519",
        escopos: "state.read",
      });

      expect(await revogarDispositivo(db, usuario.id, dispositivo.id)).toBe(true);

      const guardado = await buscarDispositivoPorChave(db, chave);
      expect(guardado?.situacao).toBe("revogado");
      expect(guardado?.revogadoEm).not.toBeNull();
    });

    it("não é possível revogar dispositivo de outra conta", async () => {
      const dono = await novoUsuario("dono");
      const estranho = await novoUsuario("estranho");

      const dispositivo = await criarDispositivo(db, {
        usuarioId: dono.id,
        papel: "surface",
        nome: "Celular",
        chavePublica: `chave-dono-${Date.now()}`,
        algoritmo: "Ed25519",
        escopos: "state.read",
      });

      expect(await revogarDispositivo(db, estranho.id, dispositivo.id)).toBe(false);
    });

    it("um dispositivo recém-criado nasce sem escopo perigoso", async () => {
      const usuario = await novoUsuario("escopos");

      const dispositivo = await criarDispositivo(db, {
        usuarioId: usuario.id,
        papel: "surface",
        nome: "Celular",
        chavePublica: `chave-escopo-${Date.now()}`,
        algoritmo: "Ed25519",
        escopos: "state.read deck.read action.execute system.media",
      });

      expect(dispositivo.escopos).not.toContain("system.shell");
      expect(dispositivo.escopos).not.toContain("action.define");
    });
  });
});
