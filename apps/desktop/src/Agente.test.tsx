// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agente } from "./Agente";

const { invocar } = vi.hoisted(() => ({ invocar: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invocar }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.1.4") }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn().mockResolvedValue(false),
  enable: vi.fn(),
  disable: vi.fn(),
}));

/*
 * O jsdom não implementa `<dialog>`.
 *
 * `showModal` e `close` simplesmente não existem lá, e sem eles qualquer tela
 * com diálogo quebra no teste por um motivo que nada tem a ver com o produto.
 * O elemento nativo é usado de propósito na janela — ele traz foco preso,
 * `Esc` e camada de topo de graça —, então o que falta é preenchido aqui, no
 * ambiente de teste, e não evitado no código.
 */
beforeEach(() => {
  const proto = window.HTMLDialogElement?.prototype;
  if (!proto) return;
  if (!proto.showModal) {
    proto.showModal = function () {
      this.open = true;
    };
  }
  if (!proto.close) {
    proto.close = function () {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
});

function celular(extra: Record<string, unknown> = {}) {
  return {
    id: "s1",
    nome: "Celular do Alan",
    papel: "surface",
    situacao: "ativo",
    online: true,
    ...extra,
  };
}

function responder(dispositivos: unknown[]) {
  invocar.mockReset();
  invocar.mockImplementation((comando: string) => {
    if (comando === "situacao") {
      return Promise.resolve({
        conectado: true,
        usuario: { id: "u1", email: "alan@exemplo.com", nome: null },
        nomeComputador: "PHANTOMX",
        chavePublica: "chave",
        dispositivos,
      });
    }
    if (comando === "criar_convite_qr") {
      return Promise.resolve({
        conviteId: "c1",
        expiraEm: new Date(Date.now() + 120_000).toISOString(),
        url: "https://slate.aionixdev.com/#convite=abc",
      });
    }
    if (comando === "remover_dispositivo") return Promise.resolve(null);
    return Promise.resolve(null);
  });
}

async function montar() {
  render(<Agente />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("tela principal do Agente", () => {
  beforeEach(() => responder([]));
  afterEach(cleanup);

  it("não gera convite nenhum quando já existe aparelho pareado", async () => {
    responder([celular()]);
    await montar();

    expect(screen.getByText("Celular do Alan")).toBeTruthy();
    // O ponto todo: nenhum QR Code é pedido ao servidor só por abrir o
    // programa. Testar pelo comando, e não pela imagem, porque um componente
    // apenas escondido por CSS continuaria queimando um convite por abertura.
    expect(invocar.mock.calls.some(([comando]) => comando === "criar_convite_qr")).toBe(false);
  });

  it("quem ainda não pareou nada cai direto no pareamento", async () => {
    responder([]);
    await montar();

    expect(invocar.mock.calls.some(([comando]) => comando === "criar_convite_qr")).toBe(true);
  });

  it("o QR só aparece quando a pessoa pede outro aparelho", async () => {
    responder([celular()]);
    await montar();

    await act(async () => {
      screen.getByRole("button", { name: "Parear outro" }).click();
    });

    expect(invocar.mock.calls.some(([comando]) => comando === "criar_convite_qr")).toBe(true);
  });

  it("pergunta se o convite foi aceito enquanto o QR está na tela", async () => {
    /*
     * O defeito que este teste tranca não aparecia como erro em lugar nenhum.
     *
     * A consulta dependia do contador regressivo, que muda a cada segundo:
     * o intervalo de dois segundos era refeito a cada um e nunca disparava.
     * O Agente não chegava a perguntar nada. A janela seguia mostrando o QR
     * depois de o celular já ter pareado — e, como esta consulta é o único
     * momento em que o aparelho entra na raiz de confiança local, o celular
     * também ficava eternamente "conectando": a oferta chegava de uma origem
     * que o Agente não reconhecia.
     *
     * Por isso o teste avança o relógio bem além de dois segundos e cobra a
     * consulta. Contar chamadas, e não olhar a tela, é o que o faz falhar com
     * o código antigo.
     */
    vi.useFakeTimers();
    try {
      responder([]);
      render(<Agente />);
      await act(async () => {
        await Promise.resolve();
      });

      // Um segundo por vez, e cada avanço dentro do seu próprio `act`.
      //
      // Avançar seis segundos de uma vez esconde o defeito: os disparos saem
      // em lote antes de o React reprocessar o estado, e o intervalo da
      // consulta sobrevive ao que no navegador o mataria. É o contador
      // regressivo — um tique por segundo, cada um com sua re-renderização —
      // que refazia a inscrição antes dos dois segundos completarem.
      for (let segundo = 0; segundo < 6; segundo++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
        });
      }

      const consultas = invocar.mock.calls.filter(
        ([comando]) => comando === "consultar_convite_qr",
      );
      expect(consultas.length).toBeGreaterThan(0);
      expect(consultas[0]?.[1]).toEqual({ conviteId: "c1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("mostra a presença de cada aparelho, que é o que se procura na lista", async () => {
    responder([celular(), celular({ id: "s2", nome: "Tablet", online: false })]);
    await montar();

    expect(screen.getByText("conectado agora")).toBeTruthy();
    expect(screen.getByText("desconectado")).toBeTruthy();
  });

  it("remover o último aparelho abre o pareamento, sem precisar reabrir o Agente", async () => {
    /*
     * O beco sem saída que isto tranca: a tela dizia "Nenhum aparelho pareado
     * ainda" e não oferecia nem QR nem código. O botão "Parear outro" só
     * existia quando havia algum aparelho, e a decisão de mostrar o pareamento
     * tinha sido tomada na montagem — quando ainda havia um. Restava fechar e
     * abrir o programa.
     */
    let pareados: unknown[] = [celular()];
    invocar.mockReset();
    invocar.mockImplementation((comando: string) => {
      if (comando === "situacao") {
        return Promise.resolve({
          conectado: true,
          usuario: { id: "u1", email: "alan@exemplo.com", nome: null },
          nomeComputador: "PHANTOMX",
          chavePublica: "chave",
          dispositivos: pareados,
        });
      }
      if (comando === "remover_dispositivo") {
        pareados = [];
        return Promise.resolve(null);
      }
      if (comando === "criar_convite_qr") {
        return Promise.resolve({
          conviteId: "c1",
          expiraEm: new Date(Date.now() + 120_000).toISOString(),
          url: "https://slate.aionixdev.com/#convite=abc",
        });
      }
      return Promise.resolve(null);
    });

    await montar();
    expect(invocar.mock.calls.some(([comando]) => comando === "criar_convite_qr")).toBe(false);

    await act(async () => {
      screen.getByRole("button", { name: "Remover" }).click();
    });
    await act(async () => {
      const confirmar = screen
        .getAllByRole("button", { name: "Remover" })
        .find((b) => b.closest(".modal"));
      confirmar!.click();
    });

    // Sem aparelho nenhum, a tela de parear precisa estar de pé — e o QR sai
    // sozinho, como sai para quem abre o programa pela primeira vez.
    expect(screen.getByText("Nenhum aparelho pareado ainda.")).toBeTruthy();
    expect(invocar.mock.calls.some(([comando]) => comando === "criar_convite_qr")).toBe(true);
    expect(screen.getByRole("button", { name: "Código" })).toBeTruthy();
  });

  it("remover um aparelho pede confirmação antes de tocar no processo em Rust", async () => {
    responder([celular()]);
    await montar();

    await act(async () => {
      screen.getByRole("button", { name: "Remover" }).click();
    });

    // Nada aconteceu ainda: remover é destrutivo e desfazer custa parear de
    // novo, com a cerimônia física inteira. O primeiro clique abre a pergunta.
    expect(invocar).not.toHaveBeenCalledWith("remover_dispositivo", { id: "s1" });
    expect(screen.getByText("Remover este aparelho?")).toBeTruthy();

    await act(async () => {
      // O botão do diálogo, e não o da lista: os dois se chamam "Remover".
      const confirmar = screen
        .getAllByRole("button", { name: "Remover" })
        .find((b) => b.closest(".modal"));
      confirmar!.click();
    });

    expect(invocar).toHaveBeenCalledWith("remover_dispositivo", { id: "s1" });
  });

  it("cancelar a remoção não remove nada", async () => {
    responder([celular()]);
    await montar();

    await act(async () => {
      screen.getByRole("button", { name: "Remover" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Cancelar" }).click();
    });

    expect(invocar).not.toHaveBeenCalledWith("remover_dispositivo", { id: "s1" });
    expect(screen.getByText("Celular do Alan")).toBeTruthy();
  });
});
