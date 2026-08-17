import { useCallback, useEffect, useState } from "react";

/**
 * Tema da janela do Agente.
 *
 * Três estados, e o terceiro é o padrão de propósito: **seguir o sistema**.
 * Um aplicativo que nasce escuro num computador configurado em claro parece
 * invasivo, e o contrário cega quem trabalha à noite. Escolher explicitamente
 * continua possível — é o que a pessoa faz quando o padrão do sistema não é o
 * que ela quer *neste* programa.
 *
 * Os tokens já sabem lidar com os três casos: sem `data-theme` valem as
 * consultas de mídia, e `data-theme="light"`/`"dark"` vencem a preferência do
 * sistema nas duas direções. Aqui só escrevemos o atributo — nenhuma cor mora
 * neste arquivo.
 */

export type Tema = "sistema" | "claro" | "escuro";

export const TEMAS: readonly { valor: Tema; rotulo: string; descricao: string }[] = [
  { valor: "sistema", rotulo: "Sistema", descricao: "Acompanha o Windows" },
  { valor: "claro", rotulo: "Claro", descricao: "Sempre claro" },
  { valor: "escuro", rotulo: "Escuro", descricao: "Sempre escuro" },
];

const CHAVE = "slate.tema";

function ehTema(valor: unknown): valor is Tema {
  return valor === "sistema" || valor === "claro" || valor === "escuro";
}

/** Lê a escolha guardada. Qualquer coisa estranha vira o padrão, sem erro. */
export function temaGuardado(): Tema {
  try {
    const guardado = window.localStorage.getItem(CHAVE);
    return ehTema(guardado) ? guardado : "sistema";
  } catch {
    // Armazenamento indisponível não é motivo para a janela não abrir.
    return "sistema";
  }
}

export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === "sistema") {
    // Remover o atributo é o que devolve a decisão às consultas de mídia.
    // Escrever "system" ali deixaria os seletores sem corresponder a nada e a
    // janela ficaria com as cores base, ignorando o sistema.
    raiz.removeAttribute("data-theme");
  } else {
    raiz.setAttribute("data-theme", tema === "claro" ? "light" : "dark");
  }
}

export function useTema(): [Tema, (tema: Tema) => void] {
  const [tema, setTema] = useState<Tema>(() => temaGuardado());

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  const escolher = useCallback((novo: Tema) => {
    setTema(novo);
    try {
      window.localStorage.setItem(CHAVE, novo);
    } catch {
      // Não poder guardar a preferência não impede de aplicá-la agora.
    }
  }, []);

  return [tema, escolher];
}
