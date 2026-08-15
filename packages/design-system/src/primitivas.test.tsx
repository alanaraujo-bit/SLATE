import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Botao, Indicador, Rotulo, Superficie } from "./primitivas";
import { COMPORTAMENTO, resolverEstado } from "./estados";
import { ESTADOS_CONTROLE } from "./tokens";

/**
 * O que estes testes protegem.
 *
 * Um control surface comanda o computador de alguém. Os erros que importam
 * aqui não são visuais: são um botão que dispara quando não devia, um controle
 * indisponível que some para quem usa teclado, e um estado que mente sobre o
 * que o computador está fazendo.
 */

describe("Botao — acionamento", () => {
  it("dispara quando está ocioso", async () => {
    const aoClicar = vi.fn();
    render(<Botao onClick={aoClicar}>Abrir OBS</Botao>);

    await userEvent.click(screen.getByRole("button"));
    expect(aoClicar).toHaveBeenCalledOnce();
  });

  it("não dispara enquanto está executando", async () => {
    // Um segundo toque durante a execução mandaria o comando duas vezes.
    const aoClicar = vi.fn();
    render(
      <Botao estado="loading" onClick={aoClicar}>
        Abrir OBS
      </Botao>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("não dispara quando está desativado", async () => {
    const aoClicar = vi.fn();
    render(
      <Botao estado="disabled" onClick={aoClicar}>
        Abrir OBS
      </Botao>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("não dispara quando o computador está fora de alcance", async () => {
    const aoClicar = vi.fn();
    render(
      <Botao estado="unavailable" onClick={aoClicar}>
        Abrir OBS
      </Botao>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("volta a disparar depois de uma falha", async () => {
    // Falhar não pode travar o controle: tentar de novo é a reação natural.
    const aoClicar = vi.fn();
    render(
      <Botao estado="error" onClick={aoClicar}>
        Abrir OBS
      </Botao>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(aoClicar).toHaveBeenCalledOnce();
  });

  it("um clique em estado inerte não vaza para o contêiner", async () => {
    // Sem isto, uma pasta ou grade acima abriria ao tocar num botão
    // indisponível, e o toque produziria um efeito que ninguém pediu.
    const aoClicarContainer = vi.fn();
    render(
      <div onClick={aoClicarContainer}>
        <Botao estado="unavailable">Abrir OBS</Botao>
      </div>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(aoClicarContainer).not.toHaveBeenCalled();
  });
});

describe("Botao — acessibilidade", () => {
  it("anuncia que está ocupado durante a execução", () => {
    render(<Botao estado="loading">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("anuncia que está impedido quando desativado", () => {
    render(<Botao estado="disabled">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
  });

  it("um controle indisponível continua alcançável pelo teclado", () => {
    // Removê-lo da ordem de tabulação esconderia justamente a explicação de
    // por que ele não responde.
    render(<Botao estado="unavailable">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).toHaveAttribute("tabindex", "0");
  });

  it("explica por que está indisponível", () => {
    render(<Botao estado="unavailable">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).toHaveTextContent(/sem conexão com o computador/i);
  });

  it("um controle desativado sai da ordem de tabulação", () => {
    // Aqui é diferente: desativado é escolha de configuração, não uma condição
    // temporária que precise ser explicada.
    render(<Botao estado="disabled">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).toHaveAttribute("tabindex", "-1");
  });

  it("aceita rótulo próprio quando o conteúdo é só um ícone", () => {
    render(<Botao rotuloAcessivel="Silenciar microfone">🎤</Botao>);
    expect(screen.getByRole("button", { name: "Silenciar microfone" })).toBeTruthy();
  });

  it("expõe o estado de alternância", () => {
    render(<Botao alternado>Microfone</Botao>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("não usa o atributo disabled nativo", () => {
    // O disabled nativo tira o elemento da árvore de acessibilidade, e um
    // controle temporariamente indisponível não pode desaparecer.
    render(<Botao estado="disabled">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).not.toHaveProperty("disabled", true);
  });

  it("é acionável pelo teclado", async () => {
    const aoClicar = vi.fn();
    render(<Botao onClick={aoClicar}>Abrir OBS</Botao>);

    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}");
    expect(aoClicar).toHaveBeenCalled();
  });
});

describe("Botao — aparência dirigida por dados", () => {
  it("expõe o estado como atributo, para o CSS não depender de classe montada", () => {
    render(<Botao estado="active">Abrir OBS</Botao>);
    expect(screen.getByRole("button")).toHaveAttribute("data-estado", "active");
  });

  it("aplica a cor escolhida pelo usuário", () => {
    render(
      <Botao cor="violet">Abrir OBS</Botao>,
    );
    const botao = screen.getByRole("button");
    expect(botao).toHaveAttribute("data-cor", "violet");
    expect(botao.getAttribute("style")).toContain("--s-control-violet");
  });

  it("todo estado declarado é renderizável", () => {
    // Impede que um estado novo entre na lista sem tratamento no componente.
    for (const estado of ESTADOS_CONTROLE) {
      const { unmount } = render(<Botao estado={estado}>Teste</Botao>);
      expect(screen.getByRole("button")).toHaveAttribute("data-estado", estado);
      unmount();
    }
  });
});

describe("resolverEstado", () => {
  it("sem conexão vence qualquer outra condição", () => {
    // Mostrar "ativo" ou "executando" com o computador fora de alcance seria
    // informação inventada.
    expect(
      resolverEstado({ conectado: false, ativo: true, executando: true, falhou: true }),
    ).toBe("unavailable");
  });

  it("desativado vence execução", () => {
    expect(resolverEstado({ conectado: true, desativado: true, executando: true })).toBe(
      "disabled",
    );
  });

  it("execução vence falha anterior", () => {
    expect(resolverEstado({ conectado: true, executando: true, falhou: true })).toBe(
      "loading",
    );
  });

  it("falha vence ativo", () => {
    expect(resolverEstado({ conectado: true, falhou: true, ativo: true })).toBe("error");
  });

  it("ocioso é o padrão", () => {
    expect(resolverEstado({ conectado: true })).toBe("idle");
  });
});

describe("tabela de comportamento", () => {
  it("cobre todos os estados declarados", () => {
    for (const estado of ESTADOS_CONTROLE) {
      expect(COMPORTAMENTO[estado], estado).toBeDefined();
    }
  });

  it("nenhum estado inerte é acionável", () => {
    for (const estado of ["loading", "disabled", "unavailable"] as const) {
      expect(COMPORTAMENTO[estado].acionavel, estado).toBe(false);
    }
  });

  it("todo estado inerte se explica", () => {
    // Um controle que não responde e não diz por quê parece quebrado.
    for (const estado of ["loading", "disabled", "unavailable"] as const) {
      expect(COMPORTAMENTO[estado].anuncio, estado).toBeTruthy();
    }
  });
});

describe("Indicador", () => {
  it("sempre acompanha texto, porque cor sozinha não comunica", () => {
    render(<Indicador situacao="ok" descricao="Conectado" />);
    expect(screen.getByText("Conectado")).toBeTruthy();
  });

  it("marca a situação para o CSS", () => {
    const { container } = render(<Indicador situacao="erro" descricao="Sem conexão" />);
    expect(container.querySelector('[data-situacao="erro"]')).toBeTruthy();
  });

  it("o ponto colorido fica escondido de leitores de tela", () => {
    // O texto ao lado já diz tudo; anunciar o ponto seria ruído.
    const { container } = render(<Indicador situacao="ok" descricao="Conectado" />);
    expect(container.querySelector(".s-indicador__ponto")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("Superficie e Rotulo", () => {
  it("a superfície expõe o nível de elevação", () => {
    const { container } = render(<Superficie nivel="sobreposta">conteúdo</Superficie>);
    expect(container.querySelector('[data-nivel="sobreposta"]')).toBeTruthy();
  });

  it("o rótulo numérico usa largura fixa por dígito", () => {
    // Sem isso, um valor que muda faz o layout tremer a cada atualização.
    const { container } = render(<Rotulo numerico>42%</Rotulo>);
    expect(container.querySelector("[data-numerico]")).toBeTruthy();
  });
});
