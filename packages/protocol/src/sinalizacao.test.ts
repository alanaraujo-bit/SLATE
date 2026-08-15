import { describe, expect, it } from "vitest";
import { mensagemClienteSinalizacao, mensagemServidorSinalizacao } from "./sinalizacao";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const FINGERPRINT = Array.from({ length: 32 }, () => "AB").join(":");

describe("contratos da sinalização", () => {
  it("aceita uma oferta limitada e assinada", () => {
    expect(
      mensagemClienteSinalizacao.safeParse({
        tipo: "oferta",
        destino: UUID_A,
        sessaoId: UUID_B,
        sdp: "v=0",
        fingerprint: {
          algoritmo: "sha-256",
          valor: FINGERPRINT,
          assinatura: "a".repeat(64),
        },
      }).success,
    ).toBe(true);
  });

  it("recusa SDP grande antes de encaminhar", () => {
    expect(
      mensagemClienteSinalizacao.safeParse({
        tipo: "oferta",
        destino: UUID_A,
        sessaoId: UUID_B,
        sdp: "x".repeat(131_073),
        fingerprint: {
          algoritmo: "sha-256",
          valor: FINGERPRINT,
          assinatura: "a".repeat(64),
        },
      }).success,
    ).toBe(false);
  });

  it("aceita a URL de origem que o webrtc-rs inclui no candidato relay", () => {
    expect(
      mensagemClienteSinalizacao.safeParse({
        tipo: "candidato",
        destino: UUID_A,
        sessaoId: UUID_B,
        candidato: {
          candidate: "candidate:1 1 UDP 1 203.0.113.1 50000 typ relay",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "ufrag",
          url: "turn:turn.cloudflare.com:3478?transport=udp",
        },
      }).success,
    ).toBe(true);
  });

  it("não deixa o cliente forjar a origem", () => {
    expect(
      mensagemClienteSinalizacao.safeParse({
        tipo: "encerrar",
        origem: UUID_A,
        destino: UUID_B,
        sessaoId: UUID_A,
      }).success,
    ).toBe(false);
  });

  it("valida a mensagem pronta devolvida pelo servidor", () => {
    expect(
      mensagemServidorSinalizacao.safeParse({
        tipo: "pronto",
        dispositivoId: UUID_A,
        papel: "surface",
        expiraEm: Date.now() + 60_000,
        servidoresIce: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
        iceExpiraEm: null,
      }).success,
    ).toBe(true);
  });

  it("limita a sincronização de revogações a IDs", () => {
    expect(
      mensagemServidorSinalizacao.safeParse({
        tipo: "revogacoes",
        dispositivoIds: [UUID_A, UUID_B],
      }).success,
    ).toBe(true);
    expect(
      mensagemServidorSinalizacao.safeParse({
        tipo: "revogacoes",
        dispositivos: [{ id: UUID_A, chavePublica: "troca-maliciosa" }],
      }).success,
    ).toBe(false);
  });
});
