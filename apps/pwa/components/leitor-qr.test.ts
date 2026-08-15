import { describe, expect, it } from "vitest";
import { extrairTokenConviteQr } from "./leitor-qr";

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
