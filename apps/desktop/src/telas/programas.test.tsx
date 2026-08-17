// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelaProgramas, nomeSugerido } from "./programas";

const { invocar } = vi.hoisted(() => ({ invocar: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invocar }));

beforeEach(() => {
  const proto = window.HTMLDialogElement?.prototype;
  if (proto && !proto.showModal) {
    proto.showModal = function () {
      this.open = true;
    };
    proto.close = function () {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
});

afterEach(cleanup);

async function montar(props: { podeUsar?: boolean } = {}) {
  render(<TelaProgramas podeUsar={props.podeUsar ?? true} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("nome sugerido a partir do arquivo", () => {
  it("usa o nome do arquivo sem a extensão", () => {
    // O comando em Rust recusa nome vazio e não inventa nenhum, de propósito.
    // Quem sugere é a interface, e o palpite certo é o nome do executável —
    // ninguém quer ver o caminho inteiro escrito na tecla do celular.
    expect(nomeSugerido("C:\\Jogos\\Cyberpunk2077.exe")).toBe("Cyberpunk2077");
    expect(nomeSugerido("C:\\Program Files\\OBS\\obs64.EXE")).toBe("obs64");
    expect(nomeSugerido("/usr/bin/steam")).toBe("steam");
  });

  it("nunca devolve vazio, porque vazio seria recusado", () => {
    expect(nomeSugerido("C:\\.exe")).toBe("Programa");
    expect(nomeSugerido("")).toBe("Programa");
  });
});

describe("tela de programas", () => {
  it("explica o que fazer quando não há nada cadastrado", async () => {
    invocar.mockReset();
    invocar.mockImplementation((comando: string) =>
      comando === "listar_atalhos" ? Promise.resolve([]) : Promise.resolve(null),
    );

    await montar();
    expect(screen.getByText("Nenhum programa cadastrado")).toBeTruthy();
  });

  it("cancelar o seletor de arquivo não cadastra nem mostra erro", async () => {
    /*
     * `escolher_programa` devolve nulo quando a pessoa fecha o diálogo do
     * Windows. Isso é uma decisão, não uma falha: tratar como erro encheria a
     * tela de vermelho por alguém ter desistido.
     */
    invocar.mockReset();
    invocar.mockImplementation((comando: string) => {
      if (comando === "listar_atalhos") return Promise.resolve([]);
      if (comando === "escolher_programa") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await montar();
    await act(async () => {
      screen.getByRole("button", { name: /Escolher o primeiro/ }).click();
    });

    expect(invocar.mock.calls.some(([c]) => c === "criar_atalho")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cadastra o programa escolhido com o nome derivado do arquivo", async () => {
    invocar.mockReset();
    let criados: unknown[] = [];
    invocar.mockImplementation((comando: string, args?: Record<string, unknown>) => {
      if (comando === "listar_atalhos") return Promise.resolve(criados);
      if (comando === "escolher_programa") {
        return Promise.resolve("C:\\Jogos\\Hollow Knight.exe");
      }
      if (comando === "criar_atalho") {
        criados = [
          {
            id: "a1",
            nome: args?.nome,
            caminho: args?.caminho,
            cor: args?.cor,
          },
        ];
        return Promise.resolve(criados[0]);
      }
      return Promise.resolve(null);
    });

    await montar();
    await act(async () => {
      screen.getByRole("button", { name: /Escolher o primeiro/ }).click();
    });

    const chamada = invocar.mock.calls.find(([c]) => c === "criar_atalho");
    expect(chamada?.[1]).toMatchObject({
      caminho: "C:\\Jogos\\Hollow Knight.exe",
      nome: "Hollow Knight",
    });
    expect(screen.getByText("Hollow Knight")).toBeTruthy();
  });

  it("avisa quando há programas mas nenhum aparelho autorizado", async () => {
    // Sem esta linha, a pessoa cadastra os jogos, olha o celular e não entende
    // por que a grade continua vazia — a permissão é dada em outra tela.
    invocar.mockReset();
    invocar.mockImplementation((comando: string) =>
      comando === "listar_atalhos"
        ? Promise.resolve([
            { id: "a1", nome: "Jogo", caminho: "C:\\jogo.exe", cor: "violet" },
          ])
        : Promise.resolve(null),
    );

    await montar({ podeUsar: false });
    expect(screen.getByRole("status").textContent).toContain("Marque a permissão");
  });

  it("remover pede confirmação", async () => {
    invocar.mockReset();
    invocar.mockImplementation((comando: string) =>
      comando === "listar_atalhos"
        ? Promise.resolve([
            { id: "a1", nome: "Jogo", caminho: "C:\\jogo.exe", cor: "violet" },
          ])
        : Promise.resolve(null),
    );

    await montar();
    await act(async () => {
      screen.getByRole("button", { name: "Remover" }).click();
    });

    expect(invocar.mock.calls.some(([c]) => c === "remover_atalho")).toBe(false);
    expect(screen.getByText("Remover este atalho?")).toBeTruthy();
  });
});
