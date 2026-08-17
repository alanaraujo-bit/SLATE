import { describe, expect, it } from "vitest";
import type { PerfilEnergia } from "@slate/protocol";
import {
  CONTROLES_ATALHOS,
  CONTROLES_ENERGIA,
  CONTROLES_MIDIA,
  CONTROLES_VOLUME,
  energiaVisivel,
  explicarSemRetorno,
  textoProntoParaRetorno,
  visiveis,
  type Controle,
} from "./controles";

const TODOS: readonly Controle[] = [
  ...CONTROLES_MIDIA,
  ...CONTROLES_VOLUME,
  ...CONTROLES_ATALHOS,
];

describe("grade de controles", () => {
  it("manda exatamente os identificadores que o Agente reconhece", () => {
    // Este conjunto é o mesmo fixado em `toda_a_grade_de_midia_e_reconhecida`,
    // em `apps/desktop/src-tauri/src/acoes.rs`. Mudar um lado sem o outro
    // produz um botão que responde "ação não encontrada" — os dois testes
    // existem para que a omissão apareça no diff em vez de aparecer na tela.
    expect(TODOS.map((c) => c.actionId).sort()).toEqual(
      [
        "midia.anterior",
        "midia.parar",
        "midia.proxima",
        "midia.reproduzir-pausar",
        "volume.aumentar",
        "volume.diminuir",
        "volume.mudo",
        "atalho.youtube",
        "atalho.twitch",
        "atalho.netflix",
        "atalho.prime",
        "atalho.disney",
        "atalho.spotify",
      ].sort(),
    );
  });

  it("todo atalho é um identificador, nunca um endereço", () => {
    // A promessa do ADR-0004 mora aqui: se um dia alguém pensar em mandar a URL
    // pelo canal para "facilitar", este teste cai. O endereço é constante de
    // compilação no Agente, e daqui vai só o nome da ação.
    for (const atalho of CONTROLES_ATALHOS) {
      expect(atalho.actionId).toMatch(/^atalho\.[a-z]+$/);
      expect(JSON.stringify(atalho)).not.toMatch(/https?:\/\//);
    }
  });

  it("não repete identificador entre os grupos", () => {
    // Duas teclas com o mesmo identificador viram chave duplicada no React e
    // uma delas some sem aviso.
    expect(new Set(TODOS.map((c) => c.actionId)).size).toBe(TODOS.length);
  });

  it("com Agente antigo sobra só o reproduzir/pausar", () => {
    // O único que o Agente 0.1.5 sabe executar. Mostrar os outros seria
    // prometer o que o computador do outro lado não faz.
    expect(visiveis(CONTROLES_MIDIA, false).map((c) => c.actionId)).toEqual([
      "midia.reproduzir-pausar",
    ]);
    expect(visiveis(CONTROLES_VOLUME, false)).toEqual([]);
  });

  it("com Agente atualizado mostra a grade inteira", () => {
    expect(visiveis(CONTROLES_MIDIA, true)).toHaveLength(3);
    expect(visiveis(CONTROLES_VOLUME, true)).toHaveLength(4);
  });

  it("destaca uma tecla só", () => {
    // O destaque ocupa duas colunas; dois deles desalinhariam a grade.
    expect(TODOS.filter((c) => c.destaque)).toHaveLength(1);
  });
});

const perfil = (over: Partial<PerfilEnergia> = {}): PerfilEnergia => ({
  bloquear: "sim",
  suspender: "sim",
  hibernar: "sim",
  reiniciar: "sim",
  desligar: "sim",
  cancelarDesligamento: "sim",
  acordarPelaRede: "sim",
  acordarDeSuspenso: "sim",
  acordarDeHibernado: "sim",
  acordarDeDesligado: "desconhecido",
  prontoParaRetorno: "hibernado",
  nivel: "PADRAO",
  ...over,
});

describe("grade de energia", () => {
  it("manda os identificadores que o Agente reconhece", () => {
    // O outro lado é `toda_a_grade_de_energia_e_reconhecida` em `acoes.rs`.
    expect(CONTROLES_ENERGIA.map((c) => c.actionId).sort()).toEqual(
      [
        "sistema.bloquear",
        "sistema.suspender",
        "sistema.hibernar",
        "sistema.reiniciar",
        "sistema.desligar",
      ].sort(),
    );
  });

  it("sem perfil não desenha tecla nenhuma", () => {
    // Um Agente que não anunciou energia não recebeu a permissão, ou é antigo
    // demais para conhecê-la. Nos dois casos, botões aqui responderiam "escopo
    // negado" ou "ação não encontrada" — pior do que não existirem.
    expect(energiaVisivel(undefined)).toEqual([]);
  });

  it("some a tecla que aquela máquina não sabe executar", () => {
    const semHibernar = energiaVisivel(perfil({ hibernar: "nao" }));
    expect(semHibernar.map((c) => c.actionId)).not.toContain("sistema.hibernar");
    expect(semHibernar.map((c) => c.actionId)).toContain("sistema.desligar");
  });

  it("desconhecido não é permissão", () => {
    // Mesma disciplina do Agente: na dúvida a tecla não aparece, em vez de
    // aparecer e falhar na hora de usar.
    expect(
      energiaVisivel(perfil({ desligar: "desconhecido" })).map((c) => c.actionId),
    ).not.toContain("sistema.desligar");
  });

  it("uma política que tira o privilégio derruba as três juntas — e só elas", () => {
    // Desligar, reiniciar e cancelar dependem do mesmo `SeShutdownPrivilege`.
    // Hibernar e suspender **não**: eles passam por `SetSuspendState`, que não
    // exige privilégio nenhum. Numa máquina de domínio com o desligamento
    // bloqueado, hibernar continua sendo o caminho — e é justamente ele que
    // sustenta o Pronto para Retorno ali.
    const travado = energiaVisivel(
      perfil({ desligar: "nao", reiniciar: "nao", cancelarDesligamento: "nao" }),
    );
    expect(travado.map((c) => c.actionId)).toEqual([
      "sistema.bloquear",
      "sistema.suspender",
      "sistema.hibernar",
    ]);
  });

  it("o que pode custar trabalho não salvo pede confirmação", () => {
    const porId = new Map(CONTROLES_ENERGIA.map((c) => [c.actionId, c.destrutiva]));
    expect(porId.get("sistema.desligar")).toBe(true);
    expect(porId.get("sistema.reiniciar")).toBe(true);
    expect(porId.get("sistema.hibernar")).toBe(true);
    // E o que não custa, não pede: confirmar tudo treina a pessoa a confirmar
    // sem ler, e aí a confirmação do desligar também deixa de proteger.
    expect(porId.get("sistema.bloquear")).toBe(false);
    expect(porId.get("sistema.suspender")).toBe(false);
  });

  it("a ausência de Pronto para Retorno é explicada, não escondida", () => {
    // O mandato é explícito: nunca esconder limitação de hardware ou de rede.
    expect(textoProntoParaRetorno(perfil({ prontoParaRetorno: "nenhum" }))).toBeUndefined();

    const semPermissao = perfil({
      prontoParaRetorno: "nenhum",
      impedimentos: ["adaptador-sem-permissao"],
    });
    expect(explicarSemRetorno(semPermissao)).toContain("não está autorizada");

    const semHibernar = perfil({
      prontoParaRetorno: "nenhum",
      impedimentos: ["hibernacao-desligada"],
    });
    expect(explicarSemRetorno(semHibernar)).toContain("hibernação está desligada");
  });

  it("a explicação não exige saber o que é S3, ACPI ou pacote mágico", () => {
    // A tela principal fala linguagem de produto; o vocabulário técnico mora
    // nos detalhes avançados (ADR-0006 e P3-M5-T11).
    const tecnico = /\bS3\b|\bS4\b|\bS5\b|ACPI|PME|mágico|magic|broadcast|MAC/i;
    for (const impedimento of [
      "adaptador-nao-suporta",
      "adaptador-sem-permissao",
      "hibernacao-desligada",
      "firmware-precisa-de-ajuste",
      "nao-testado",
      "sem-ponte-na-rede",
    ] as const) {
      const texto = explicarSemRetorno(
        perfil({ prontoParaRetorno: "nenhum", impedimentos: [impedimento] }),
      );
      expect(texto, `vazou jargão em ${impedimento}: ${texto}`).not.toMatch(tecnico);
    }
    for (const controle of CONTROLES_ENERGIA) {
      expect(controle.rotulo).not.toMatch(tecnico);
    }
  });
});
