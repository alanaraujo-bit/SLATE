import { describe, expect, it } from "vitest";
import {
  ACOES_ENERGIA,
  ACOES_ENERGIA_DESTRUTIVAS,
  ESTADOS_ACORDAR,
  acordarTerminou,
  escolherProntoParaRetorno,
  nivelDeCompatibilidade,
  perfilEnergia,
  transicaoAcordar,
  type EstadoAcordar,
  type EventoAcordar,
  type PerfilEnergia,
} from "./energia";
import { ESCOPOS_PADRAO, ESCOPOS_SOMENTE_NO_PC, autoriza } from "./mensagens";

/**
 * Testes da energia remota.
 *
 * O que está coberto aqui é a regra, não o hardware: escolha do estado, nível de
 * compatibilidade e máquina de estados do acordar. O comportamento que depende
 * de uma placa de rede real é autoteste no Agente, e está registrado como tal —
 * ver ADR-0006 e o critério `acordar-real` de P3-M5-T7.
 */

const capaz = (over: Partial<PerfilEnergia> = {}): PerfilEnergia => ({
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

describe("escolha do estado de Pronto para Retorno", () => {
  it("prefere desligado quando o retorno a partir dele foi comprovado", () => {
    expect(escolherProntoParaRetorno(capaz({ acordarDeDesligado: "sim" }))).toBe(
      "desligado",
    );
  });

  it("cai para hibernado quando o retorno de desligado não foi comprovado", () => {
    // `desconhecido` é o estado normal: nenhuma leitura do Windows responde
    // isso com confiança, só um autoteste real.
    expect(escolherProntoParaRetorno(capaz())).toBe("hibernado");
  });

  it("nunca aposta num retorno apenas desconhecido", () => {
    // O teste que sustenta a promessa do ADR-0006. Se alguém trocar a
    // comparação por `!== "nao"` para "aproveitar melhor o hardware", o
    // resultado é uma máquina desligada que não liga mais pelo celular — e este
    // teste cai antes de alguém descobrir isso do jeito difícil.
    const soDesconhecido = capaz({
      acordarDeDesligado: "desconhecido",
      acordarDeHibernado: "desconhecido",
    });
    expect(escolherProntoParaRetorno(soDesconhecido)).toBe("nenhum");
  });

  it("não existe Pronto para Retorno sem acordar pela rede", () => {
    const semRede = capaz({ acordarPelaRede: "nao", acordarDeDesligado: "sim" });
    expect(escolherProntoParaRetorno(semRede)).toBe("nenhum");
  });

  it("não escolhe um estado que a máquina não sabe entrar", () => {
    // Acordar de hibernado não serve de nada se a máquina não hiberna — é o
    // caso real de quem tem a hibernação desligada no Windows.
    const semHibernar = capaz({ hibernar: "nao" });
    expect(escolherProntoParaRetorno(semHibernar)).toBe("nenhum");
  });
});

describe("nível de compatibilidade", () => {
  it("é COMPLETO só com retorno de desligado e ponte na rede", () => {
    const perfil = capaz({ acordarDeDesligado: "sim" });
    expect(nivelDeCompatibilidade(perfil, true)).toBe("COMPLETO");
  });

  it("hardware impecável sem ponte não é COMPLETO", () => {
    // A casa com um computador só. O hardware não tem defeito nenhum e mesmo
    // assim ninguém consegue acordá-lo do 4G, porque não há quem emita o
    // pacote. Chamar isso de COMPLETO seria a mentira que o ADR-0006 proíbe.
    const perfil = capaz({ acordarDeDesligado: "sim" });
    expect(nivelDeCompatibilidade(perfil, false)).toBe("PADRAO");
  });

  it("é LIMITADO quando não há como voltar pela rede", () => {
    expect(nivelDeCompatibilidade(capaz({ acordarPelaRede: "nao" }), true)).toBe(
      "LIMITADO",
    );
  });
});

describe("máquina de estados do acordar", () => {
  const percorrer = (eventos: EventoAcordar[], inicial: EstadoAcordar = "WAKE_REQUESTED") =>
    eventos.reduce(transicaoAcordar, inicial);

  it("vai do pedido ao online pelo caminho completo", () => {
    expect(
      percorrer([
        { tipo: "pedido" },
        { tipo: "ponte-emitiu" },
        { tipo: "alvo-na-sinalizacao" },
        { tipo: "sessao-aberta" },
      ]),
    ).toBe("ONLINE");
  });

  it("pacote emitido não é computador ligado", () => {
    // O erro clássico desta funcionalidade, fixado como teste: depois de
    // `ponte-emitiu` o estado é WAKE_SENT, e nada além da sessão viva promove
    // para ONLINE.
    const depoisDoPacote = percorrer([{ tipo: "pedido" }, { tipo: "ponte-emitiu" }]);
    expect(depoisDoPacote).toBe("WAKE_SENT");
    expect(acordarTerminou(depoisDoPacote)).toBe(false);
  });

  it("tempo esgotado é estado final e evento atrasado não o desfaz", () => {
    const esgotado = percorrer([
      { tipo: "pedido" },
      { tipo: "ponte-emitiu" },
      { tipo: "tempo-esgotado" },
    ]);
    expect(esgotado).toBe("TIMED_OUT");
    expect(transicaoAcordar(esgotado, { tipo: "alvo-na-sinalizacao" })).toBe("TIMED_OUT");
  });

  it("online não é desfeito por um tempo esgotado atrasado", () => {
    // Cenário real: a retentativa anterior dispara o temporizador dela depois
    // de o computador já ter voltado pela tentativa seguinte.
    expect(transicaoAcordar("ONLINE", { tipo: "tempo-esgotado" })).toBe("ONLINE");
  });

  it("pedido repetido não empurra quem já está esperando de volta", () => {
    // Retentativa emite outro pacote; ela não pode rebobinar o progresso.
    const esperando = percorrer([
      { tipo: "pedido" },
      { tipo: "ponte-emitiu" },
      { tipo: "alvo-na-sinalizacao" },
    ]);
    expect(esperando).toBe("AGENT_CONNECTING");
    expect(transicaoAcordar(esperando, { tipo: "ponte-emitiu" })).toBe("AGENT_CONNECTING");
  });

  it("sessão aberta vence de qualquer estado não final", () => {
    // O alvo pode voltar sem que a ponte tenha confirmado coisa alguma — um
    // pacote perdido no caminho de volta não pode esconder um PC ligado.
    for (const estado of ESTADOS_ACORDAR) {
      const resultado = transicaoAcordar(estado, { tipo: "sessao-aberta" });
      expect(resultado).toBe(acordarTerminou(estado) ? estado : "ONLINE");
    }
  });

  it("ausência de ponte e ausência de suporte são estados distintos", () => {
    // Uma se resolve ligando outro computador da conta; a outra não se resolve.
    // Colapsar as duas em "falhou" tiraria da pessoa a única informação útil.
    expect(transicaoAcordar("WAKE_REQUESTED", { tipo: "sem-ponte" })).toBe("NO_BRIDGE");
    expect(transicaoAcordar("WAKE_REQUESTED", { tipo: "sem-suporte" })).toBe("UNSUPPORTED");
    expect(transicaoAcordar("WAKE_REQUESTED", { tipo: "ponte-falhou" })).toBe("FAILED");
  });
});

describe("autorização das ações de energia", () => {
  it("o pareamento não concede energia nenhuma", () => {
    // O ponto inteiro do desenho: um celular recém-pareado controla mídia e não
    // desliga nem acorda computador nenhum.
    expect(ESCOPOS_PADRAO).not.toContain("system.power");
    expect(ESCOPOS_PADRAO).not.toContain("system.wake");
  });

  it("energia só é concedida na frente do computador", () => {
    expect(ESCOPOS_SOMENTE_NO_PC).toContain("system.power");
    expect(ESCOPOS_SOMENTE_NO_PC).toContain("system.wake");
  });

  it("desligar e acordar são autorizações separadas", () => {
    // Quem quer só o botão de ligar não deve ser obrigado a conceder o de
    // desligar. Se alguém fundir os dois escopos, este teste cai.
    expect(ACOES_ENERGIA.acordar).not.toBe(ACOES_ENERGIA.desligar);
    const soAcordar: readonly ("system.wake")[] = ["system.wake"];
    expect(soAcordar).not.toContain("system.power");
  });

  it("receber o perfil é leitura, não poder", () => {
    // Saber que aquele computador hiberna não é poder hibernar. Sem isto a
    // interface não teria como explicar por que um botão não está lá.
    expect(autoriza("energia.estado", ESCOPOS_PADRAO)).toBe(true);
  });

  it("tudo que pode custar trabalho não salvo está marcado como destrutivo", () => {
    // A lista que a PWA usa para decidir o que exige confirmação deliberada.
    // Esquecer um item aqui é um desligamento a um toque de distância.
    expect(ACOES_ENERGIA_DESTRUTIVAS).toContain(ACOES_ENERGIA.desligar);
    expect(ACOES_ENERGIA_DESTRUTIVAS).toContain(ACOES_ENERGIA.reiniciar);
    expect(ACOES_ENERGIA_DESTRUTIVAS).toContain(ACOES_ENERGIA.hibernar);
    expect(ACOES_ENERGIA_DESTRUTIVAS).toContain(ACOES_ENERGIA.prontoParaRetorno);
    // Bloquear não destrói nada e não deve pedir cerimônia.
    expect(ACOES_ENERGIA_DESTRUTIVAS).not.toContain(ACOES_ENERGIA.bloquear);
  });
});

describe("perfil como mensagem", () => {
  it("aceita um perfil completo", () => {
    expect(perfilEnergia.safeParse(capaz()).success).toBe(true);
  });

  it("não tem onde carregar endereço físico", () => {
    // Mesma regra de `atalhoDeDeck` não carregar caminho: o endereço vai da
    // nuvem direto para a ponte, e nunca passa pelo celular (ADR-0006 §3).
    const comMac = perfilEnergia.parse({ ...capaz(), mac: "AA:BB:CC:DD:EE:FF" });
    expect(comMac).not.toHaveProperty("mac");
  });

  it("recusa um suporte que não seja um dos três valores", () => {
    // `talvez` seria exatamente o tipo de terceiro caminho que faz a interface
    // inventar um comportamento não decidido.
    expect(perfilEnergia.safeParse(capaz({ hibernar: "talvez" as never })).success).toBe(
      false,
    );
  });
});
