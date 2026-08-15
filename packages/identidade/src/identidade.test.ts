import { describe, expect, it } from "vitest";
import {
  ALGORITMOS,
  ehAlgoritmoConhecido,
  melhorAlgoritmoDisponivel,
  suportado,
  type Algoritmo,
} from "./algoritmos";
import {
  assinar,
  deBase64Url,
  exportarChavePublica,
  gerarIdentidade,
  impressaoDigital,
  importarChavePublica,
  paraBase64Url,
  verificar,
} from "./chaves";
import {
  MAX_TENTATIVAS,
  TAMANHO_CODIGO,
  VALIDADE_MS,
  comparacaoSegura,
  criarPedido,
  formatarCodigo,
  gerarCodigo,
  pedidoAtivo,
  segundosRestantes,
  verificarCodigo,
} from "./pareamento";

/**
 * Este é o código que decide quem pode comandar o computador de alguém. Os
 * testes abaixo tratam as regras de recusa como o produto principal: aceitar
 * uma assinatura inválida ou um código expirado é a falha que importa, não
 * deixar de aceitar uma válida.
 */

describe("algoritmos", () => {
  it.each(ALGORITMOS)("%s está disponível neste ambiente", async (algoritmo) => {
    expect(await suportado(algoritmo)).toBe(true);
  });

  it("prefere Ed25519 quando disponível", async () => {
    expect(await melhorAlgoritmoDisponivel()).toBe("Ed25519");
  });

  it("recusa nome de algoritmo desconhecido", () => {
    expect(ehAlgoritmoConhecido("RSA-1024")).toBe(false);
    expect(ehAlgoritmoConhecido("Ed25519")).toBe(true);
  });
});

describe.each(ALGORITMOS)("identidade com %s", (algoritmo: Algoritmo) => {
  it("gera uma identidade utilizável", async () => {
    const identidade = await gerarIdentidade({ algoritmo });
    expect(identidade.algoritmo).toBe(algoritmo);
    expect(identidade.chavePublicaExportada.length).toBeGreaterThan(20);
  });

  it("a chave privada não é extraível por padrão", async () => {
    // É o que impede um script injetado de copiar a identidade do aparelho.
    const identidade = await gerarIdentidade({ algoritmo });
    expect(identidade.chavePrivada.extractable).toBe(false);
  });

  it("assina e verifica a própria assinatura", async () => {
    const identidade = await gerarIdentidade({ algoritmo });
    const assinatura = await assinar(identidade, "parear:abc123");

    expect(
      await verificar(identidade.chavePublicaExportada, algoritmo, "parear:abc123", assinatura),
    ).toBe(true);
  });

  it("recusa assinatura de outra chave", async () => {
    const legitima = await gerarIdentidade({ algoritmo });
    const impostora = await gerarIdentidade({ algoritmo });
    const assinatura = await assinar(impostora, "parear:abc123");

    expect(
      await verificar(legitima.chavePublicaExportada, algoritmo, "parear:abc123", assinatura),
    ).toBe(false);
  });

  it("recusa quando a mensagem foi alterada", async () => {
    // O caso concreto: alguém intercepta e troca o alvo do comando.
    const identidade = await gerarIdentidade({ algoritmo });
    const assinatura = await assinar(identidade, "acao:mutar-microfone");

    expect(
      await verificar(
        identidade.chavePublicaExportada,
        algoritmo,
        "acao:desligar-computador",
        assinatura,
      ),
    ).toBe(false);
  });

  it("a chave pública sobrevive a exportar e importar", async () => {
    const identidade = await gerarIdentidade({ algoritmo });
    const reimportada = await importarChavePublica(
      identidade.chavePublicaExportada,
      algoritmo,
    );

    expect(await exportarChavePublica(reimportada)).toBe(
      identidade.chavePublicaExportada,
    );
  });
});

describe("verificação — entradas hostis", () => {
  it("recusa em vez de lançar diante de assinatura sem sentido", async () => {
    // Caminho de erro separado em código de verificação é onde a falha que
    // ninguém revisa se instala.
    const identidade = await gerarIdentidade({ algoritmo: "Ed25519" });

    for (const lixo of ["", "nao-e-base64!!", "AAAA", "x".repeat(500)]) {
      expect(
        await verificar(identidade.chavePublicaExportada, "Ed25519", "msg", lixo),
        lixo.slice(0, 20),
      ).toBe(false);
    }
  });

  it("recusa algoritmo desconhecido sem tentar verificar", async () => {
    const identidade = await gerarIdentidade({ algoritmo: "Ed25519" });
    const assinatura = await assinar(identidade, "msg");

    expect(
      await verificar(identidade.chavePublicaExportada, "MD5", "msg", assinatura),
    ).toBe(false);
  });

  it("recusa quando a chave pública é inválida", async () => {
    expect(await verificar("nao-e-uma-chave", "Ed25519", "msg", "AAAA")).toBe(false);
  });

  it("uma assinatura Ed25519 não vale como ECDSA", async () => {
    const identidade = await gerarIdentidade({ algoritmo: "Ed25519" });
    const assinatura = await assinar(identidade, "msg");

    expect(
      await verificar(identidade.chavePublicaExportada, "ECDSA-P256", "msg", assinatura),
    ).toBe(false);
  });
});

describe("impressão digital", () => {
  it("é estável para a mesma chave", async () => {
    const identidade = await gerarIdentidade({ algoritmo: "Ed25519" });
    const a = await impressaoDigital(identidade.chavePublicaExportada);
    const b = await impressaoDigital(identidade.chavePublicaExportada);
    expect(a).toBe(b);
  });

  it("difere entre chaves diferentes", async () => {
    const uma = await gerarIdentidade({ algoritmo: "Ed25519" });
    const outra = await gerarIdentidade({ algoritmo: "Ed25519" });

    expect(await impressaoDigital(uma.chavePublicaExportada)).not.toBe(
      await impressaoDigital(outra.chavePublicaExportada),
    );
  });

  it("é curta o bastante para alguém ler em voz alta", async () => {
    const identidade = await gerarIdentidade({ algoritmo: "Ed25519" });
    const digital = await impressaoDigital(identidade.chavePublicaExportada);
    expect(digital).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  });
});

describe("base64url", () => {
  it("sobrevive à ida e volta", () => {
    const original = new Uint8Array([0, 1, 250, 255, 128, 64]);
    expect([...deBase64Url(paraBase64Url(original))]).toEqual([...original]);
  });

  it("não usa caracteres que precisariam de escape em URL", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const texto = paraBase64Url(bytes);
    expect(texto).not.toMatch(/[+/=]/);
  });
});

describe("código de pareamento", () => {
  it("tem o tamanho esperado e só dígitos", () => {
    for (let i = 0; i < 50; i++) {
      expect(gerarCodigo()).toMatch(new RegExp(`^\\d{${TAMANHO_CODIGO}}$`));
    }
  });

  it("preserva zeros à esquerda", () => {
    // Tratar o código como número comeria o zero inicial e produziria um
    // código de cinco dígitos que nunca confere.
    const codigos = Array.from({ length: 400 }, gerarCodigo);
    expect(codigos.every((c) => c.length === TAMANHO_CODIGO)).toBe(true);
  });

  it("não repete de forma perceptível", () => {
    const codigos = new Set(Array.from({ length: 300 }, gerarCodigo));
    expect(codigos.size).toBeGreaterThan(290);
  });
});

describe("comparacaoSegura", () => {
  it("aceita valores iguais", () => {
    expect(comparacaoSegura("123456", "123456")).toBe(true);
  });

  it("recusa valores diferentes", () => {
    expect(comparacaoSegura("123456", "123457")).toBe(false);
  });

  it("recusa quando só o primeiro caractere difere", () => {
    // Uma comparação que sai cedo vazaria essa informação pelo tempo.
    expect(comparacaoSegura("923456", "123456")).toBe(false);
  });

  it("recusa tamanhos diferentes sem lançar", () => {
    expect(comparacaoSegura("12345", "123456")).toBe(false);
    expect(comparacaoSegura("", "123456")).toBe(false);
  });
});

describe("verificação do código", () => {
  const novoPedido = (agora = 1_000_000) =>
    criarPedido({
      id: "pedido-1",
      chavePublicaSolicitante: "chave-abc",
      algoritmo: "Ed25519",
      agora,
    });

  it("confirma com o código certo", () => {
    const pedido = novoPedido();
    const resultado = verificarCodigo(pedido, pedido.codigo, 1_000_100);

    expect(resultado.ok).toBe(true);
    expect(pedido.situacao).toBe("confirmado");
  });

  it("aceita o código com espaços em volta", () => {
    // Quem digita olhando para outra tela erra o espaçamento com frequência.
    const pedido = novoPedido();
    expect(verificarCodigo(pedido, `  ${pedido.codigo} `, 1_000_100).ok).toBe(true);
  });

  it("recusa código errado e desconta uma tentativa", () => {
    const pedido = novoPedido();
    const resultado = verificarCodigo(pedido, "000000", 1_000_100);

    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.tentativasRestantes).toBe(MAX_TENTATIVAS - 1);
  });

  it("bloqueia o pedido inteiro depois das tentativas", () => {
    // Recomeçar precisa exigir código novo, senão o espaço de busca encolhe a
    // cada rodada de tentativas.
    const pedido = novoPedido();
    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      verificarCodigo(pedido, "000000", 1_000_100);
    }

    expect(pedido.situacao).toBe("bloqueado");
  });

  it("um pedido bloqueado recusa até o código certo", () => {
    const pedido = novoPedido();
    const correto = pedido.codigo;

    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      verificarCodigo(pedido, "000000", 1_000_100);
    }

    const resultado = verificarCodigo(pedido, correto, 1_000_100);
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.motivo).toBe("bloqueado");
  });

  it("recusa depois de expirado", () => {
    const pedido = novoPedido();
    const resultado = verificarCodigo(pedido, pedido.codigo, 1_000_000 + VALIDADE_MS + 1);

    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.motivo).toBe("expirado");
  });

  it("expirar não consome tentativa", () => {
    // Do contrário, esperar o pedido morrer seria uma forma de gastar as
    // tentativas de outra pessoa.
    const pedido = novoPedido();
    verificarCodigo(pedido, "000000", 1_000_000 + VALIDADE_MS + 1);
    expect(pedido.tentativas).toBe(0);
  });

  it("um código não serve duas vezes", () => {
    const pedido = novoPedido();
    verificarCodigo(pedido, pedido.codigo, 1_000_100);

    const segunda = verificarCodigo(pedido, pedido.codigo, 1_000_200);
    expect(segunda.ok).toBe(false);
    expect(!segunda.ok && segunda.motivo).toBe("ja_usado");
  });

  it("guarda a chave de quem pediu, para o PC saber o que autoriza", () => {
    const pedido = novoPedido();
    expect(pedido.chavePublicaSolicitante).toBe("chave-abc");
  });
});

describe("estado do pedido", () => {
  it("está ativo enquanto pendente e dentro do prazo", () => {
    const pedido = criarPedido({
      id: "p",
      chavePublicaSolicitante: "k",
      algoritmo: "Ed25519",
      agora: 0,
    });
    expect(pedidoAtivo(pedido, 1000)).toBe(true);
    expect(pedidoAtivo(pedido, VALIDADE_MS + 1)).toBe(false);
  });

  it("a contagem regressiva chega a zero e não fica negativa", () => {
    const pedido = criarPedido({
      id: "p",
      chavePublicaSolicitante: "k",
      algoritmo: "Ed25519",
      agora: 0,
    });
    expect(segundosRestantes(pedido, 0)).toBe(120);
    expect(segundosRestantes(pedido, VALIDADE_MS + 5000)).toBe(0);
  });

  it("formata em dois grupos, que é como se lê e se digita", () => {
    expect(formatarCodigo("123456")).toBe("123 456");
  });
});
