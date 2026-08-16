import { describe, expect, it } from "vitest";
import {
  CONTROLES_ATALHOS,
  CONTROLES_MIDIA,
  CONTROLES_VOLUME,
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
