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

  it("mostra a presença de cada aparelho, que é o que se procura na lista", async () => {
    responder([celular(), celular({ id: "s2", nome: "Tablet", online: false })]);
    await montar();

    expect(screen.getByText("conectado agora")).toBeTruthy();
    expect(screen.getByText("desconectado")).toBeTruthy();
  });

  it("remover um aparelho pede a remoção pelo processo em Rust", async () => {
    responder([celular()]);
    await montar();

    await act(async () => {
      screen.getByRole("button", { name: "Remover" }).click();
    });

    expect(invocar).toHaveBeenCalledWith("remover_dispositivo", { id: "s1" });
  });
});
