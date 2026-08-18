import { z } from "zod";
import { VERSAO_PROTOCOLO } from "./envelope";

/**
 * Handshake e negociação de capacidades (ADR-0003).
 *
 * A PWA se atualiza sozinha; o Agente é um instalador que pode ficar meses sem
 * ser atualizado. Estar fora de sincronia é o estado normal, não a exceção —
 * então a negociação existe para que isso funcione, em vez de quebrar.
 */

/**
 * Capacidades conhecidas.
 *
 * Uma capacidade é a unidade de evolução do protocolo: recurso novo entra como
 * capacidade nova, nunca como versão nova. Assim um Agente antigo continua
 * funcionando — ele apenas não anuncia o que não sabe fazer.
 */
export const CAPACIDADES = [
  "action.execute",
  "action.media",
  /**
   * Faixa, parada e volume — tudo o que veio depois do reproduzir/pausar.
   *
   * Capacidade separada de `action.media` porque a PWA publica na hora e o
   * Agente é um instalador: sem isto, um Agente 0.1.5 anunciaria `action.media`
   * e receberia botões que ele responde com "ação não encontrada". A separação
   * é o que faz a grade mostrar só o que o computador do outro lado sabe fazer.
   */
  "action.media.completo",
  /**
   * Atalhos de abertura.
   *
   * Anunciada **por par**, e só para quem recebeu a permissão marcada na
   * interface do Agente. Não é uma propriedade da versão do Agente como as
   * outras: dois celulares ligados ao mesmo computador podem receber helos
   * diferentes, e é isso que faz a permissão aparecer e sumir na tela do
   * celular sem consultar a conta.
   */
  "action.atalhos",
  "action.define",
  /**
   * Bloquear, suspender, hibernar, reiniciar e desligar aquele computador, e a
   * mensagem `energia.estado` que descreve o que ele sabe fazer (ADR-0006).
   *
   * Anunciada **por par**, como `action.atalhos`: depende da permissão marcada
   * na janela do Agente para aquele aparelho, não da versão instalada.
   */
  "energia.controle",
  /**
   * Este Agente sabe emitir o pacote que acorda outra máquina da conta na mesma
   * rede — ou seja, sabe ser ponte.
   *
   * Separada de `energia.controle` porque as duas respondem perguntas
   * diferentes: uma é "o que este computador faz consigo mesmo", a outra é "este
   * computador serve para ligar os outros". Um Agente pode ter a primeira sem a
   * segunda, num notebook sem rede utilizável.
   */
  "energia.ponte",
  /**
   * Este Agente sabe falar com o CALL instalado naquele computador — mutar o
   * microfone e receber de volta o que está acontecendo na chamada.
   *
   * **Não é anunciada por par**, diferente de `action.atalhos` e
   * `energia.controle`: mutar entra sob `system.media`, que o pareamento já
   * concede, pela mesma razão do volume — mexer numa chamada que já está
   * acontecendo é a mesma autoridade que mexer no que já está tocando. Exigir
   * marcação na janela obrigaria a reparear todo aparelho existente para ganhar
   * um botão de mudo.
   *
   * Ela também não promete que o CALL está aberto. Isso é `disponivel`, em
   * `call.estado`: capacidade é o que o Agente sabe fazer, estado é o que dá
   * para fazer agora.
   */
  "call.controle",
  "state.system",
  "state.media",
  "context.rules",
  "deck.sync",
  "obs.control",
  "git.status",
  "script.run",
] as const;

export type Capacidade = (typeof CAPACIDADES)[number];

export const papelDispositivo = z.enum(["agent", "surface"]);
export type PapelDispositivo = z.infer<typeof papelDispositivo>;

export const hello = z.object({
  protocolVersion: z.number().int().positive(),
  appVersion: z.string().min(1).max(32),
  role: papelDispositivo,
  deviceId: z.string().min(1).max(128),
  /**
   * Aceita string livre, e não o enum, de propósito: uma versão futura pode
   * anunciar capacidade que esta versão desconhece, e desconhecido precisa ser
   * ignorado em silêncio, não virar erro de validação.
   */
  capabilities: z.array(z.string().min(1).max(64)).max(64),
});

export type Hello = z.infer<typeof hello>;

export type ResultadoNegociacao =
  | {
      compativel: true;
      capacidades: Capacidade[];
      atualizacaoDisponivel: boolean;
    }
  | {
      compativel: false;
      motivo: "agente_desatualizado" | "cliente_desatualizado";
      versaoLocal: number;
      versaoRemota: number;
    };

/**
 * Negocia uma sessão a partir do hello do outro lado.
 *
 * Diferença de versão maior é incompatível nas duas direções, mas com
 * orientações opostas: se o remoto está atrás, quem precisa atualizar é ele; se
 * está à frente, quem precisa recarregar é este lado.
 */
export function negociar(
  remoto: Hello,
  locais: readonly string[] = CAPACIDADES,
  versaoLocal: number = VERSAO_PROTOCOLO,
): ResultadoNegociacao {
  if (remoto.protocolVersion !== versaoLocal) {
    return {
      compativel: false,
      motivo:
        remoto.protocolVersion < versaoLocal
          ? "agente_desatualizado"
          : "cliente_desatualizado",
      versaoLocal,
      versaoRemota: remoto.protocolVersion,
    };
  }

  const conjuntoLocal = new Set(locais);
  const capacidades = remoto.capabilities.filter((c): c is Capacidade =>
    conjuntoLocal.has(c),
  );

  return {
    compativel: true,
    capacidades,
    // O remoto conhece menos do que nós: funciona, mas vale avisar que há
    // versão mais nova. Não é erro, é informação.
    atualizacaoDisponivel: capacidades.length < conjuntoLocal.size,
  };
}

/** Estados de conexão que a interface precisa saber explicar (§37). */
export const ESTADOS_CONEXAO = [
  "CONNECTED",
  "CONNECTING",
  "RECONNECTING",
  "OFFLINE",
  "AGENT_UNAVAILABLE",
  "AUTH_REQUIRED",
  "PAIRING_REQUIRED",
  "VERSION_MISMATCH",
] as const;

export type EstadoConexao = (typeof ESTADOS_CONEXAO)[number];
