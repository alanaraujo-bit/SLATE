import { describe, expect, it } from "vitest";
import { ehConviteDeOutroEndereco, extrairTokenConviteQr } from "./leitor-qr";

describe("conteúdo do QR de pareamento", () => {
  const token = "a".repeat(43);

  it("aceita somente convite da própria origem", () => {
    expect(
      extrairTokenConviteQr(
        `https://slate.aionixdev.com/#convite=${token}`,
        "https://slate.aionixdev.com",
      ),
    ).toBe(token);
    expect(
      extrairTokenConviteQr(`https://falso.test/#convite=${token}`, "https://slate.aionixdev.com"),
    ).toBeNull();
  });

  it("distingue convite de outro endereço de um QR qualquer", () => {
    // Só muda a mensagem: um QR do SLATE vindo de outro endereço continua
    // recusado. O que se evita é mandar a pessoa procurar defeito onde não há
    // — foi o endereço que mudou, não o QR que está errado.
    expect(
      ehConviteDeOutroEndereco(
        `https://outro-endereco.test/#convite=${token}`,
        "https://slate.aionixdev.com",
      ),
    ).toBe(true);
    expect(
      extrairTokenConviteQr(
        `https://outro-endereco.test/#convite=${token}`,
        "https://slate.aionixdev.com",
      ),
    ).toBeNull();

    // Um QR de outra coisa qualquer não vira "convite de outro endereço".
    expect(
      ehConviteDeOutroEndereco("https://exemplo.test/pagina", "https://slate.aionixdev.com"),
    ).toBe(false);
    expect(ehConviteDeOutroEndereco("texto solto", "https://slate.aionixdev.com")).toBe(false);
    // Mesma origem não é "outro endereço" — esse caminho é o de sucesso.
    expect(
      ehConviteDeOutroEndereco(
        `https://slate.aionixdev.com/#convite=${token}`,
        "https://slate.aionixdev.com",
      ),
    ).toBe(false);
  });

  it("recusa texto comum e token curto", () => {
    expect(extrairTokenConviteQr("não é URL", "https://slate.aionixdev.com")).toBeNull();
    expect(
      extrairTokenConviteQr(
        "https://slate.aionixdev.com/#convite=curto",
        "https://slate.aionixdev.com",
      ),
    ).toBeNull();
  });
});
