import { describe, expect, it, vi } from "vitest";
import { TransporteWebRtc } from "./transporte-webrtc";

function transporte() {
  return new TransporteWebRtc({
    identidade: {} as never,
    agente: {} as never,
    aoMudarEstado: vi.fn(),
  });
}

describe("execução de ações pelo DataChannel", () => {
  it("recusa imediatamente quando não há canal, sem enfileirar", async () => {
    await expect(transporte().executarAcao("midia.reproduzir-pausar")).resolves.toEqual({
      ok: false,
      mensagem: "O computador não está conectado.",
    });
  });

  it("correlaciona o resultado final com o pedido enviado", async () => {
    const canal = { readyState: "open", send: vi.fn(), close: vi.fn() };
    const cliente = transporte();
    Reflect.set(cliente, "canal", canal);
    Reflect.set(cliente, "jaConectou", true);

    const resultado = cliente.executarAcao("midia.reproduzir-pausar");
    const pedido = JSON.parse(canal.send.mock.calls[0]![0] as string) as { id: string };
    const receber = Reflect.get(cliente, "receberDoCanal").bind(cliente) as (
      bruto: string,
    ) => void;

    receber(
      JSON.stringify({
        v: 1,
        id: "resposta-1",
        t: "res",
        k: "action.execute.result",
        ts: Date.now(),
        seq: 1,
        p: { accepted: true, executionId: pedido.id },
      }),
    );
    receber(
      JSON.stringify({
        v: 1,
        id: "resultado-1",
        t: "evt",
        k: "action.result",
        ts: Date.now(),
        seq: 2,
        p: { executionId: pedido.id, ok: true, durationMs: 2 },
      }),
    );

    await expect(resultado).resolves.toEqual({
      ok: true,
      mensagem: "Comando executado no computador.",
    });
  });

  it("explica quando o Agente recusa por falta de permissão", async () => {
    const canal = { readyState: "open", send: vi.fn(), close: vi.fn() };
    const cliente = transporte();
    Reflect.set(cliente, "canal", canal);
    Reflect.set(cliente, "jaConectou", true);

    const resultado = cliente.executarAcao("midia.reproduzir-pausar");
    const pedido = JSON.parse(canal.send.mock.calls[0]![0] as string) as { id: string };
    const receber = Reflect.get(cliente, "receberDoCanal").bind(cliente) as (
      bruto: string,
    ) => void;
    receber(
      JSON.stringify({
        v: 1,
        id: "recusa-1",
        t: "res",
        k: "action.execute.result",
        ts: Date.now(),
        seq: 1,
        p: {
          accepted: false,
          executionId: pedido.id,
          rejectedReason: "escopo_negado",
        },
      }),
    );

    await expect(resultado).resolves.toEqual({
      ok: false,
      mensagem: "Este aparelho não tem permissão para essa ação.",
    });
  });
});
