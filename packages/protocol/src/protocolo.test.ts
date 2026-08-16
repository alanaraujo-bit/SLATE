import { describe, expect, it } from "vitest";
import {
  JANELA_TIMESTAMP_MS,
  VERSAO_PROTOCOLO,
  criarEnvelope,
  novoEstadoSessao,
  reiniciarSequencia,
  validarEnvelope,
} from "./envelope";
import { CAPACIDADES, negociar, type Hello } from "./handshake";
import {
  CORES_ATALHO,
  ESCOPOS_PADRAO,
  ESCOPOS_SOMENTE_NO_PC,
  autoriza,
  validarConteudo,
} from "./mensagens";

/**
 * Testes de protocolo.
 *
 * O mandato §56 nomeia os cenários que precisam ser cobertos: reconexão,
 * mensagem duplicada, timeout, estado obsoleto e versão incompatível. Estes
 * testes existem para esses casos, não para o caminho feliz.
 */

const AGORA = 1_786_768_350_000;

const envelopeCru = (over: Partial<Record<string, unknown>> = {}) => ({
  v: VERSAO_PROTOCOLO,
  id: "abc",
  t: "req",
  k: "action.execute",
  ts: AGORA,
  seq: 0,
  p: {},
  ...over,
});

describe("validação de envelope", () => {
  it("aceita um envelope bem formado", () => {
    const r = validarEnvelope(envelopeCru(), novoEstadoSessao(), AGORA);
    expect(r.ok).toBe(true);
  });

  it("recusa qualquer coisa que não seja um envelope", () => {
    for (const lixo of [null, undefined, 42, "texto", [], {}]) {
      expect(validarEnvelope(lixo, novoEstadoSessao(), AGORA).motivo).toBe("malformado");
    }
  });

  it("recusa versão de protocolo diferente", () => {
    const r = validarEnvelope(envelopeCru({ v: 99 }), novoEstadoSessao(), AGORA);
    expect(r.motivo).toBe("versao_incompativel");
  });

  it("recusa mensagem antiga demais", () => {
    const r = validarEnvelope(
      envelopeCru({ ts: AGORA - JANELA_TIMESTAMP_MS - 1 }),
      novoEstadoSessao(),
      AGORA,
    );
    expect(r.motivo).toBe("timestamp_fora_da_janela");
  });

  it("recusa mensagem com timestamp no futuro", () => {
    // Guardar uma mensagem com data futura para reenviar depois é justamente o
    // ataque que uma janela só para trás deixaria passar.
    const r = validarEnvelope(
      envelopeCru({ ts: AGORA + JANELA_TIMESTAMP_MS + 1 }),
      novoEstadoSessao(),
      AGORA,
    );
    expect(r.motivo).toBe("timestamp_fora_da_janela");
  });

  it("recusa a mesma mensagem enviada duas vezes", () => {
    const sessao = novoEstadoSessao();
    const msg = envelopeCru({ seq: 5 });

    expect(validarEnvelope(msg, sessao, AGORA).ok).toBe(true);
    expect(validarEnvelope(msg, sessao, AGORA).motivo).toBe("sequencia_repetida");
  });

  it("recusa sequência que anda para trás", () => {
    const sessao = novoEstadoSessao();
    expect(validarEnvelope(envelopeCru({ seq: 10 }), sessao, AGORA).ok).toBe(true);
    expect(validarEnvelope(envelopeCru({ seq: 9 }), sessao, AGORA).motivo).toBe(
      "sequencia_repetida",
    );
  });

  it("aceita respostas fora de ordem", () => {
    // Respostas correlacionam por id e podem chegar em qualquer ordem; exigir
    // sequência crescente nelas recusaria tráfego perfeitamente legítimo.
    const sessao = novoEstadoSessao();
    expect(validarEnvelope(envelopeCru({ t: "res", seq: 10 }), sessao, AGORA).ok).toBe(true);
    expect(validarEnvelope(envelopeCru({ t: "res", seq: 3 }), sessao, AGORA).ok).toBe(true);
  });

  it("uma sessão nova não herda o contador da anterior", () => {
    // É isto que faz reconexão funcionar: sem sessão própria, toda reconexão
    // pareceria repetição de mensagem.
    const primeira = novoEstadoSessao();
    validarEnvelope(envelopeCru({ seq: 100 }), primeira, AGORA);

    const segunda = novoEstadoSessao();
    expect(validarEnvelope(envelopeCru({ seq: 0 }), segunda, AGORA).ok).toBe(true);
  });
});

describe("criação de envelope", () => {
  it("incrementa a sequência a cada mensagem", () => {
    reiniciarSequencia();
    const a = criarEnvelope("req", "action.execute", {}, { agora: AGORA });
    const b = criarEnvelope("req", "action.execute", {}, { agora: AGORA });
    expect(b.seq).toBe(a.seq + 1);
  });

  it("gera identificadores distintos", () => {
    const a = criarEnvelope("req", "action.execute", {}, { agora: AGORA });
    const b = criarEnvelope("req", "action.execute", {}, { agora: AGORA });
    expect(a.id).not.toBe(b.id);
  });

  it("produz envelope que passa na própria validação", () => {
    reiniciarSequencia();
    const e = criarEnvelope("req", "action.execute", { actionId: "x" }, { agora: AGORA });
    expect(validarEnvelope(e, novoEstadoSessao(), AGORA).ok).toBe(true);
  });
});

describe("negociação", () => {
  const hello = (over: Partial<Hello> = {}): Hello => ({
    protocolVersion: VERSAO_PROTOCOLO,
    appVersion: "0.1.0",
    role: "agent",
    deviceId: "dispositivo-1",
    capabilities: [...CAPACIDADES],
    ...over,
  });

  it("conecta quando as versões batem", () => {
    const r = negociar(hello());
    expect(r.compativel).toBe(true);
  });

  it("opera na interseção das capacidades", () => {
    const r = negociar(hello({ capabilities: ["action.execute", "state.system"] }));
    expect(r.compativel && r.capacidades).toEqual(["action.execute", "state.system"]);
  });

  it("ignora capacidade desconhecida em vez de falhar", () => {
    // Um Agente mais novo pode anunciar algo que esta versão não conhece. Isso
    // precisa ser ignorado em silêncio, senão o futuro quebra o presente.
    const r = negociar(hello({ capabilities: ["action.execute", "recurso.do.futuro"] }));
    expect(r.compativel && r.capacidades).toEqual(["action.execute"]);
  });

  it("sinaliza atualização disponível quando o remoto sabe menos", () => {
    const r = negociar(hello({ capabilities: ["action.execute"] }));
    expect(r.compativel && r.atualizacaoDisponivel).toBe(true);
  });

  it("identifica agente desatualizado", () => {
    const r = negociar(hello({ protocolVersion: VERSAO_PROTOCOLO - 1 }));
    expect(r.compativel).toBe(false);
    expect(!r.compativel && r.motivo).toBe("agente_desatualizado");
  });

  it("identifica cliente desatualizado", () => {
    const r = negociar(hello({ protocolVersion: VERSAO_PROTOCOLO + 1 }));
    expect(r.compativel).toBe(false);
    expect(!r.compativel && r.motivo).toBe("cliente_desatualizado");
  });
});

describe("validação de conteúdo", () => {
  it("recusa tipo que não está no registro", () => {
    const r = validarConteudo("qualquer.coisa", {});
    expect(r.ok).toBe(false);
  });

  it("recusa conteúdo que não bate com o schema do tipo", () => {
    const r = validarConteudo("action.execute", { actionId: 123 });
    expect(r.ok).toBe(false);
  });

  it("aceita conteúdo válido", () => {
    const r = validarConteudo("action.execute", { actionId: "abrir-obs" });
    expect(r.ok).toBe(true);
  });

  it("aceita resultado de sucesso com erro nulo, e não só ausente", () => {
    /*
     * O defeito que isto tranca era invisível e diário: o Agente serializava a
     * ausência de erro como `null`, o schema exigia ausente, e **toda ação
     * bem-sucedida** era descartada na validação. O comando funcionava no
     * computador e, dez segundos depois, a tela dizia "o computador não
     * respondeu a tempo". Só as falhas chegavam, porque nelas o campo é texto.
     */
    const base = { executionId: "e1", ok: true, durationMs: 12 };
    expect(validarConteudo("action.result", base).ok).toBe(true);
    expect(validarConteudo("action.result", { ...base, error: null }).ok).toBe(true);
    expect(validarConteudo("action.result", { ...base, error: undefined }).ok).toBe(true);
    // Falha continua carregando o motivo legível.
    expect(
      validarConteudo("action.result", { ...base, ok: false, error: "sumiu" }).ok,
    ).toBe(true);
    // E o campo continua sendo texto: número ali seria conteúdo inesperado.
    expect(validarConteudo("action.result", { ...base, error: 7 }).ok).toBe(false);
  });

  it("recusa percentual de CPU fora da faixa", () => {
    expect(validarConteudo("state.system", { cpu: 150, memoria: 10 }).ok).toBe(false);
  });

  it("aceita estado de sistema sem GPU", () => {
    // Ausente é diferente de zero: zero fingiria uma leitura que não existe.
    expect(validarConteudo("state.system", { cpu: 10, memoria: 20 }).ok).toBe(true);
  });
});

describe("deck de atalhos", () => {
  const atalho = (over: Record<string, unknown> = {}) => ({
    id: "8a1f",
    nome: "Elden Ring",
    cor: "violet",
    ...over,
  });

  it("aceita a lista sem ícone e com ícone PNG", () => {
    // Um programa sem ícone extraível continua sendo um atalho válido: recusar
    // a lista inteira por causa do desenho trocaria a funcionalidade por nada.
    expect(validarConteudo("deck.estado", { atalhos: [atalho()] }).ok).toBe(true);
    expect(
      validarConteudo("deck.estado", {
        atalhos: [atalho({ icone: "data:image/png;base64,iVBORw0KGgo=" })],
      }).ok,
    ).toBe(true);
  });

  it("recusa um ícone que não seja PNG embutido", () => {
    // Este valor vai direto para o `src` de uma imagem. Sem a checagem do
    // prefixo, um Agente comprometido teria caminho até a renderização.
    for (const icone of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "https://exemplo.invalido/icone.png",
    ]) {
      expect(validarConteudo("deck.estado", { atalhos: [atalho({ icone })] }).ok).toBe(
        false,
      );
    }
  });

  it("recusa cor fora da lista fechada", () => {
    // A cor vira `var(--s-control-<cor>)`. Aceitar texto livre aqui seria
    // deixar o canal escrever na folha de estilo.
    expect(validarConteudo("deck.estado", { atalhos: [atalho({ cor: "rosa" })] }).ok).toBe(
      false,
    );
    for (const cor of CORES_ATALHO) {
      expect(validarConteudo("deck.estado", { atalhos: [atalho({ cor })] }).ok).toBe(true);
    }
  });

  it("aceita a lista em fatias", () => {
    // Cem atalhos com um PNG em cada um não cabem numa mensagem de
    // DataChannel, e estourar o teto não dá erro legível: mata o canal.
    expect(
      validarConteudo("deck.estado", { atalhos: [atalho()], parte: 2, total: 3 }).ok,
    ).toBe(true);
  });

  it("ler o deck é escopo do pareamento; abrir programa não", () => {
    expect(autoriza("deck.estado", ESCOPOS_PADRAO)).toBe(true);
    expect(ESCOPOS_PADRAO).not.toContain("system.process");
  });
});

describe("escopos", () => {
  it("um dispositivo recém-pareado não recebe shell", () => {
    expect(ESCOPOS_PADRAO).not.toContain("system.shell");
    expect(ESCOPOS_PADRAO).not.toContain("action.define");
  });

  it("os escopos perigosos são os que exigem o PC", () => {
    for (const escopo of ESCOPOS_SOMENTE_NO_PC) {
      expect(ESCOPOS_PADRAO).not.toContain(escopo);
    }
  });

  it("nega execução a quem não tem o escopo", () => {
    expect(autoriza("action.execute", ["state.read"])).toBe(false);
  });

  it("permite execução a quem tem o escopo", () => {
    expect(autoriza("action.execute", ESCOPOS_PADRAO)).toBe(true);
  });

  it("não exige escopo para respostas e eventos de resultado", () => {
    // O Agente responde ao que ele mesmo aceitou; exigir escopo aqui recusaria
    // a própria resposta.
    expect(autoriza("action.result", [])).toBe(true);
    expect(autoriza("action.progress", [])).toBe(true);
  });
});
