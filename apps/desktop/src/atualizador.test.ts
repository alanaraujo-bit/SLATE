import { describe, expect, it } from "vitest";
import {
  aplicarEventoDownload,
  mensagemDeErro,
  type SituacaoAtualizacao,
} from "./atualizador";

describe("progresso da atualização", () => {
  const inicio: Extract<SituacaoAtualizacao, { tipo: "baixando" }> = {
    tipo: "baixando",
    versao: "1.2.0",
    baixados: 0,
  };

  it("usa o tamanho real anunciado pelo servidor", () => {
    expect(
      aplicarEventoDownload(inicio, {
        event: "Started",
        data: { contentLength: 10_000 },
      }),
    ).toEqual({ ...inicio, total: 10_000 });
  });

  it("soma cada bloco recebido em vez de simular porcentagem", () => {
    const depois = aplicarEventoDownload(inicio, {
      event: "Progress",
      data: { chunkLength: 4_096 },
    });
    expect(depois).toMatchObject({ tipo: "baixando", baixados: 4_096 });
  });

  it("só diz que está instalando depois de o download terminar", () => {
    expect(aplicarEventoDownload(inicio, { event: "Finished" })).toEqual({
      tipo: "instalando",
      versao: "1.2.0",
    });
  });
});

describe("mensagens de falha da atualização", () => {
  it("não culpa a internet quando o canal de releases ainda não foi configurado", () => {
    expect(mensagemDeErro("status code: 503; invalid release JSON")).toBe(
      "As atualizações ainda não estão configuradas neste ambiente.",
    );
  });
});
