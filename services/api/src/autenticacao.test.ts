import { describe, expect, it } from "vitest";
import {
  PARAMETROS_ATUAIS,
  gastarTempoEquivalente,
  gerarHashSenha,
  validarSenha,
  verificarSenha,
} from "./senha";
import {
  NOME_COOKIE,
  RENOVAR_APOS_MS,
  VALIDADE_MS,
  criarTokenSessao,
  emailValido,
  hashDoToken,
  lerCookieSessao,
  montarCookie,
  montarCookieDeSaida,
  normalizarEmail,
  precisaRenovar,
  sessaoExpirada,
} from "./sessao";

/**
 * O ADR-0005 assume um risco: autenticação escrita por nós é responsabilidade
 * nossa. A contrapartida declarada lá foi que cada propriedade viraria teste, e
 * não comentário. É o que este arquivo faz.
 */

describe("hash de senha", () => {
  it("aceita a senha correta", async () => {
    const hash = await gerarHashSenha("cavalo-bateria-grampo");
    expect((await verificarSenha("cavalo-bateria-grampo", hash)).confere).toBe(true);
  });

  it("recusa a senha errada", async () => {
    const hash = await gerarHashSenha("cavalo-bateria-grampo");
    expect((await verificarSenha("cavalo-bateria-grampa", hash)).confere).toBe(false);
  });

  it("a mesma senha gera hashes diferentes", async () => {
    // Sem sal por senha, contas com a mesma senha teriam o mesmo hash, e uma
    // tabela pré-computada quebraria todas de uma vez.
    const a = await gerarHashSenha("mesma-senha-aqui");
    const b = await gerarHashSenha("mesma-senha-aqui");
    expect(a).not.toBe(b);
  });

  it("guarda os parâmetros junto do hash", async () => {
    // É o que permite aumentar o custo depois sem invalidar senhas existentes.
    const hash = await gerarHashSenha("cavalo-bateria-grampo");
    expect(hash.startsWith(`scrypt$${PARAMETROS_ATUAIS.N}$8$1$`)).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("marca para atualização quando o hash usa parâmetros mais fracos", async () => {
    const antigo = await gerarHashSenha("cavalo-bateria-grampo", {
      N: 2 ** 12,
      r: 8,
      p: 1,
    });

    const resultado = await verificarSenha("cavalo-bateria-grampo", antigo);
    expect(resultado.confere).toBe(true);
    expect(resultado.precisaAtualizar).toBe(true);
  });

  it("não marca para atualização quando já está no custo atual", async () => {
    const hash = await gerarHashSenha("cavalo-bateria-grampo");
    expect((await verificarSenha("cavalo-bateria-grampo", hash)).precisaAtualizar).toBe(
      false,
    );
  });

  it("trata senhas equivalentes em Unicode como iguais", async () => {
    // "á" pode vir como um caractere ou como "a" + acento combinante. Sem
    // normalizar, a mesma senha digitada em aparelhos diferentes não entraria.
    const composto = "senhá-forte";
    const decomposto = "senhá-forte";

    const hash = await gerarHashSenha(composto);
    expect((await verificarSenha(decomposto, hash)).confere).toBe(true);
  });
});

describe("hash de senha — entradas hostis", () => {
  it("recusa em vez de lançar para qualquer formato inválido", async () => {
    const invalidos = [
      "",
      "nao-e-hash",
      "scrypt$",
      "scrypt$1$2$3$4",
      "bcrypt$32768$8$1$c2Fs$aGFzaA",
      "scrypt$abc$8$1$c2Fs$aGFzaA",
      "$$$$$",
    ];

    for (const guardado of invalidos) {
      const resultado = await verificarSenha("qualquer", guardado);
      expect(resultado.confere, guardado).toBe(false);
    }
  });

  it("recusa parâmetro absurdo sem travar o processo", async () => {
    // Um N enorme num registro corrompido viraria negação de serviço na
    // verificação, e não um simples login recusado.
    const inicio = Date.now();
    const resultado = await verificarSenha(
      "qualquer",
      "scrypt$1073741824$8$1$c2FsdGVzdGU$aGFzaA",
    );

    expect(resultado.confere).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it("recusa hash com tamanho diferente do esperado", async () => {
    expect((await verificarSenha("x", "scrypt$32768$8$1$c2Fs$YWJj")).confere).toBe(false);
  });
});

describe("tempo equivalente", () => {
  it("custa algo comparável a uma verificação real", async () => {
    // Responder mais rápido para e-mail inexistente entregaria quais endereços
    // têm conta — o passo anterior a tentar senhas.
    const hash = await gerarHashSenha("cavalo-bateria-grampo");

    const inicioReal = Date.now();
    await verificarSenha("errada", hash);
    const real = Date.now() - inicioReal;

    const inicioFalso = Date.now();
    await gastarTempoEquivalente();
    const falso = Date.now() - inicioFalso;

    // Tolerância larga porque o relógio de teste é ruidoso; o que não pode é
    // ser ordens de grandeza diferente.
    expect(falso).toBeGreaterThan(real * 0.3);
  });
});

describe("validação de senha", () => {
  it("aceita uma senha razoável", () => {
    expect(validarSenha("cavalo-bateria-grampo")).toEqual([]);
  });

  it("recusa senha curta", () => {
    expect(validarSenha("abc123").map((p) => p.codigo)).toContain("curta");
  });

  it("recusa senha comum", () => {
    expect(validarSenha("password").map((p) => p.codigo)).toContain("comum");
  });

  it("recusa senha comum em qualquer caixa", () => {
    expect(validarSenha("PassWord").map((p) => p.codigo)).toContain("comum");
  });

  it("recusa senha absurdamente longa", () => {
    // scrypt processa a entrada inteira: senha de megabytes seria carga
    // gratuita para o servidor.
    expect(validarSenha("a".repeat(300)).map((p) => p.codigo)).toContain("longa");
  });

  it("conta emoji como um caractere", () => {
    // Contar unidades UTF-16 faria uma senha de 5 emojis parecer ter 10.
    expect(validarSenha("🔑🔒🛡️🎮💻").map((p) => p.codigo)).toContain("curta");
  });

  it("aceita senha de exatamente 8 caracteres", () => {
    expect(validarSenha("abcdefgh").map((p) => p.codigo)).not.toContain("curta");
  });
});

describe("token de sessão", () => {
  it("gera tokens distintos", () => {
    const vistos = new Set(Array.from({ length: 200 }, () => criarTokenSessao().token));
    expect(vistos.size).toBe(200);
  });

  it("o token nunca é igual ao que vai para o banco", () => {
    // Se fossem iguais, um vazamento do banco entregaria sessões prontas.
    const sessao = criarTokenSessao();
    expect(sessao.hash).not.toBe(sessao.token);
  });

  it("o hash é reproduzível a partir do token", () => {
    const sessao = criarTokenSessao();
    expect(hashDoToken(sessao.token)).toBe(sessao.hash);
  });

  it("o token é seguro para cookie e URL", () => {
    for (let i = 0; i < 100; i++) {
      expect(criarTokenSessao().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("expira na janela definida", () => {
    const agora = new Date("2026-01-01T00:00:00Z");
    const sessao = criarTokenSessao(agora);
    expect(sessao.expiraEm.getTime() - agora.getTime()).toBe(VALIDADE_MS);
  });
});

describe("ciclo de vida da sessão", () => {
  const base = new Date("2026-01-01T00:00:00Z");

  it("não está expirada antes do prazo", () => {
    const fim = new Date(base.getTime() + 1000);
    expect(sessaoExpirada(fim, base)).toBe(false);
  });

  it("está expirada no instante exato do prazo", () => {
    expect(sessaoExpirada(base, base)).toBe(true);
  });

  it("só renova depois da folga", () => {
    // Renovar a cada requisição significaria uma escrita no banco por
    // requisição, sem diferença prática para quem usa.
    const usoRecente = new Date(base.getTime() - RENOVAR_APOS_MS + 1000);
    expect(precisaRenovar(usoRecente, base)).toBe(false);

    const usoAntigo = new Date(base.getTime() - RENOVAR_APOS_MS - 1000);
    expect(precisaRenovar(usoAntigo, base)).toBe(true);
  });
});

describe("cookie", () => {
  const expira = new Date(Date.now() + VALIDADE_MS);

  it("é inacessível a script", () => {
    // É o que limita o estrago de uma injeção de script na PWA.
    expect(montarCookie("abc", expira, { seguro: true })).toContain("HttpOnly");
  });

  it("não acompanha requisições vindas de outros sites", () => {
    expect(montarCookie("abc", expira, { seguro: true })).toContain("SameSite=Lax");
  });

  it("exige HTTPS quando configurado como seguro", () => {
    expect(montarCookie("abc", expira, { seguro: true })).toContain("Secure");
  });

  it("omite Secure apenas quando explicitamente inseguro", () => {
    // Necessário em http://localhost, onde Secure impediria o cookie de ser
    // gravado — e por isso mesmo esta configuração precisa ser deliberada.
    expect(montarCookie("abc", expira, { seguro: false })).not.toContain("Secure");
  });

  it("vale para toda a aplicação", () => {
    expect(montarCookie("abc", expira, { seguro: true })).toContain("Path=/");
  });

  it("o cookie de saída repete os atributos do original", () => {
    // O navegador só sobrescreve um cookie quando Path, SameSite e Secure
    // batem; sem isso o logout não apaga nada e a pessoa continua conectada.
    const saida = montarCookieDeSaida({ seguro: true });
    expect(saida).toContain("Path=/");
    expect(saida).toContain("SameSite=Lax");
    expect(saida).toContain("Secure");
    expect(saida).toContain("Max-Age=0");
  });

  it("o cookie de saída não carrega valor", () => {
    expect(montarCookieDeSaida({ seguro: true }).startsWith(`${NOME_COOKIE}=;`)).toBe(
      true,
    );
  });
});

describe("leitura do cookie", () => {
  it("encontra a sessão entre outros cookies", () => {
    expect(lerCookieSessao(`outro=1; ${NOME_COOKIE}=meu-token; mais=2`)).toBe(
      "meu-token",
    );
  });

  it("tolera espaços", () => {
    expect(lerCookieSessao(`  ${NOME_COOKIE} = token-com-espaco  `)).toBe(
      "token-com-espaco",
    );
  });

  it("devolve nulo quando não há cookie", () => {
    expect(lerCookieSessao(null)).toBeNull();
    expect(lerCookieSessao("")).toBeNull();
    expect(lerCookieSessao("outro=1")).toBeNull();
  });

  it("devolve nulo para cookie vazio", () => {
    expect(lerCookieSessao(`${NOME_COOKIE}=`)).toBeNull();
  });

  it("não confunde com cookie de nome parecido", () => {
    // Sem comparação exata do nome, um cookie de outro sistema poderia ser
    // lido como sessão.
    expect(lerCookieSessao(`${NOME_COOKIE}_antigo=errado`)).toBeNull();
  });
});

describe("e-mail", () => {
  it("normaliza caixa e espaços", () => {
    expect(normalizarEmail("  Alan@Exemplo.COM ")).toBe("alan@exemplo.com");
  });

  it("não remove pontos nem etiquetas", () => {
    // Essas regras são de provedores específicos; aplicá-las a todos faria
    // endereços legítimos e distintos colidirem numa mesma conta.
    expect(normalizarEmail("a.l.a.n+slate@exemplo.com")).toBe("a.l.a.n+slate@exemplo.com");
  });

  it("aceita endereços válidos", () => {
    for (const email of [
      "alan@exemplo.com",
      "alan.araujo+slate@aionixdev.com.br",
      "a@b.co",
    ]) {
      expect(emailValido(email), email).toBe(true);
    }
  });

  it("recusa endereços inválidos", () => {
    for (const email of [
      "",
      "sem-arroba",
      "@sem-usuario.com",
      "sem-dominio@",
      "com espaco@exemplo.com",
      "duplo@@exemplo.com",
      `${"a".repeat(250)}@exemplo.com`,
    ]) {
      expect(emailValido(email), email).toBe(false);
    }
  });
});
