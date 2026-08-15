import type { DispositivoResumo } from "./api";
import type { ParConfiavel } from "./identidade-local";

export interface AgenteSelecionado {
  par: ParConfiavel;
  dispositivo: DispositivoResumo;
}

/**
 * Escolhe uma identidade, não um nome.
 *
 * Reinstalações podem deixar registros com o mesmo nome e chaves diferentes.
 * O Agente realmente online sempre vence; sem presença, usamos o acesso mais
 * recente para a reconexão continuar tentando a instalação mais provável.
 */
export function selecionarAgente(
  pares: readonly ParConfiavel[],
  dispositivos: readonly DispositivoResumo[],
): AgenteSelecionado | null {
  const candidatos = pares.flatMap((par) => {
    const dispositivo = dispositivos.find(
      (d) =>
        d.id === par.id &&
        d.papel === "agent" &&
        d.situacao === "ativo" &&
        d.chavePublica === par.chavePublica,
    );
    return dispositivo ? [{ par, dispositivo }] : [];
  });

  candidatos.sort((a, b) => {
    if (a.dispositivo.online !== b.dispositivo.online) {
      return a.dispositivo.online ? -1 : 1;
    }
    return momento(b.dispositivo) - momento(a.dispositivo);
  });

  return candidatos[0] ?? null;
}

function momento(dispositivo: DispositivoResumo): number {
  const valor = dispositivo.ultimoAcessoEm ?? dispositivo.criadoEm;
  const data = Date.parse(valor);
  return Number.isFinite(data) ? data : 0;
}
