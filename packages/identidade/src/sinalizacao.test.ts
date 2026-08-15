import { describe, expect, it } from "vitest";
import {
  mensagemConfirmacaoPareamento,
  mensagemCriacaoConviteQr,
  mensagemDesafioSinalizacao,
  mensagemFingerprintDtls,
  normalizarFingerprintDtls,
} from "./sinalizacao";

describe("formas canônicas da sinalização", () => {
  it("fixa a ordem e o domínio do desafio", () => {
    expect(
      mensagemDesafioSinalizacao({
        desafioId: "11111111-1111-4111-8111-111111111111",
        dispositivoId: "22222222-2222-4222-8222-222222222222",
        nonce: "abc_123",
        expiraEm: 1_786_768_350_610,
      }),
    ).toBe(
      [
        "SLATE-SIGNAL-CHALLENGE/v1",
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "abc_123",
        "1786768350610",
      ].join("\n"),
    );
  });

  it("amarra a confirmação à chave do Agente", () => {
    expect(
      mensagemConfirmacaoPareamento({
        codigo: " 123456 ",
        chavePublicaAgente: "chave-do-agente",
      }),
    ).toBe("SLATE-PAIR-CONFIRM/v1\n123456\nchave-do-agente");
  });

  it("amarra a criação do QR à chave do Agente", () => {
    expect(
      mensagemCriacaoConviteQr({
        nonce: "nonce-unico",
        chavePublicaAgente: "chave-do-agente",
      }),
    ).toBe("SLATE-PAIR-QR-CREATE/v1\nnonce-unico\nchave-do-agente");
  });

  it("normaliza o fingerprint antes de assinar", () => {
    const valor = "aa:bb:cc";
    expect(normalizarFingerprintDtls(`  ${valor} `)).toBe("AA:BB:CC");
    expect(
      mensagemFingerprintDtls({
        sessaoId: "11111111-1111-4111-8111-111111111111",
        dispositivoId: "22222222-2222-4222-8222-222222222222",
        algoritmo: "sha-256",
        valor,
      }),
    ).toContain("\nAA:BB:CC");
  });
});
