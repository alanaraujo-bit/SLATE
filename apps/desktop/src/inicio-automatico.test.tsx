// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InicioAutomatico } from "./inicio-automatico";

const { consultar, ativar, desativar } = vi.hoisted(() => ({
  consultar: vi.fn(),
  ativar: vi.fn(),
  desativar: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: consultar,
  enable: ativar,
  disable: desativar,
}));

describe("inicialização com o Windows", () => {
  beforeEach(() => {
    consultar.mockReset().mockResolvedValue(false);
    ativar.mockReset().mockResolvedValue(undefined);
    desativar.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("mostra o estado que está realmente registrado no Windows", async () => {
    consultar.mockResolvedValue(true);
    render(<InicioAutomatico />);

    const controle = screen.getByRole("switch", {
      name: "Abrir o SLATE ao entrar no Windows",
    }) as HTMLInputElement;
    expect(controle.disabled).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(controle.checked).toBe(true);
    expect(controle.disabled).toBe(false);
  });

  it("só muda o controle depois de o Windows confirmar", async () => {
    let concluir!: () => void;
    ativar.mockReturnValue(new Promise<void>((resolver) => (concluir = resolver)));
    render(<InicioAutomatico />);
    await act(async () => {
      await Promise.resolve();
    });
    const controle = screen.getByRole("switch", {
      name: "Abrir o SLATE ao entrar no Windows",
    }) as HTMLInputElement;

    fireEvent.click(controle);
    expect(controle.checked).toBe(false);
    expect(controle.disabled).toBe(true);

    await act(async () => concluir());
    expect(ativar).toHaveBeenCalledOnce();
    expect(controle.checked).toBe(true);
  });

  it("mantém o estado anterior e explica quando o Windows recusa", async () => {
    ativar.mockRejectedValue(new Error("acesso recusado"));
    render(<InicioAutomatico />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
      await Promise.resolve();
    });

    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("Windows não permitiu ativar");
  });
});
