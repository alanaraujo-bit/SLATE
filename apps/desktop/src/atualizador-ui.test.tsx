// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Atualizador } from "./atualizador";

const { buscar, reiniciar } = vi.hoisted(() => ({
  buscar: vi.fn(),
  reiniciar: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.1.0") }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: reiniciar }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: buscar }));

describe("experiência de atualização", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buscar.mockReset().mockResolvedValue(null);
    reiniciar.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("busca automaticamente depois de abrir sem interromper a tela", async () => {
    render(<Atualizador />);
    expect(buscar).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(buscar).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(buscar).toHaveBeenCalledWith({ timeout: 15_000 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("mostra a versão encontrada e permite adiar de verdade", async () => {
    const fechar = vi.fn().mockResolvedValue(undefined);
    buscar.mockResolvedValue({
      version: "0.2.0",
      body: "Instalador mais claro e atualização segura.",
      close: fechar,
    });
    render(<Atualizador />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Buscar atualização" }));
      await Promise.resolve();
    });
    expect(screen.getByText("SLATE 0.2.0 está pronto")).toBeTruthy();
    expect(screen.getByText(/Instalador mais claro/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agora não" }));
      await Promise.resolve();
    });
    expect(fechar).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Buscar atualização" })).toBeTruthy();
  });

  it("não transforma falta de internet na abertura em alarme", async () => {
    buscar.mockRejectedValue(new Error("network error"));
    render(<Atualizador />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(screen.queryByText(/Não foi possível consultar/)).toBeNull();
  });

  it("baixa o pacote confirmado, acompanha eventos reais e reinicia", async () => {
    const baixarEInstalar = vi.fn(async (aoEvento: (evento: unknown) => void) => {
      aoEvento({ event: "Started", data: { contentLength: 8_192 } });
      aoEvento({ event: "Progress", data: { chunkLength: 4_096 } });
      aoEvento({ event: "Finished" });
    });
    buscar.mockResolvedValue({
      version: "0.2.0",
      body: "Atualização validada.",
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: baixarEInstalar,
    });
    render(<Atualizador />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Buscar atualização" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Baixar e atualizar" }));
      await Promise.resolve();
    });

    expect(baixarEInstalar).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 5 * 60_000,
    });
    expect(screen.getByText(/Atualização verificada/)).toBeTruthy();
    expect(reiniciar).toHaveBeenCalledOnce();
  });
});
