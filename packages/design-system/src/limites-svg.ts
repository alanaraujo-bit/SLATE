export interface Ponto {
  x: number;
  y: number;
}

export interface Limites {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Quantos parâmetros cada comando de caminho consome.
 *
 * `Z` fecha a figura e não consome nenhum. Comandos com mais parâmetros do que
 * o declarado repetem implicitamente — `L 1 2 3 4` são dois segmentos —, e o
 * leitor abaixo trata isso.
 */
const PARAMETROS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/**
 * Extrai os pontos finais de cada segmento de um caminho SVG.
 *
 * Existe porque a verificação ingênua — pegar todo número do caminho e exigir
 * que caiba na grade — está errada: comandos em minúscula usam coordenadas
 * relativas, então um `-6.5` legítimo aparece como se fosse coordenada fora da
 * caixa. Rastrear a posição corrente é a única forma de saber onde o desenho
 * realmente vai parar.
 *
 * Considera apenas pontos finais. Uma curva pode se afastar deles por causa
 * dos pontos de controle, mas para detectar desenho vazando da grade os
 * extremos dos segmentos bastam.
 */
export function pontosDoCaminho(d: string): Ponto[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];

  const pontos: Ponto[] = [];
  let x = 0;
  let y = 0;
  let inicioX = 0;
  let inicioY = 0;
  let i = 0;
  let comandoAnterior = "";

  while (i < tokens.length) {
    let token = tokens[i]!;
    let comando: string;

    if (/[A-Za-z]/.test(token)) {
      comando = token;
      i += 1;
    } else {
      // Números sem comando repetem o anterior. Depois de um M, a repetição
      // vira L — é o que a especificação determina.
      if (!comandoAnterior) break;
      comando =
        comandoAnterior === "M" ? "L" : comandoAnterior === "m" ? "l" : comandoAnterior;
    }

    const maiuscula = comando.toUpperCase();
    const relativo = comando !== maiuscula;
    const quantidade = PARAMETROS[maiuscula];

    if (quantidade === undefined) break;

    if (quantidade === 0) {
      x = inicioX;
      y = inicioY;
      comandoAnterior = comando;
      continue;
    }

    const numeros: number[] = [];
    for (let n = 0; n < quantidade; n++) {
      token = tokens[i]!;
      if (token === undefined || /[A-Za-z]/.test(token)) break;
      numeros.push(Number.parseFloat(token));
      i += 1;
    }

    if (numeros.length < quantidade) break;

    switch (maiuscula) {
      case "H":
        x = relativo ? x + numeros[0]! : numeros[0]!;
        break;
      case "V":
        y = relativo ? y + numeros[0]! : numeros[0]!;
        break;
      default: {
        // O ponto final é sempre o último par de parâmetros.
        const fx = numeros[quantidade - 2]!;
        const fy = numeros[quantidade - 1]!;
        x = relativo ? x + fx : fx;
        y = relativo ? y + fy : fy;
        break;
      }
    }

    if (maiuscula === "M") {
      inicioX = x;
      inicioY = y;
    }

    pontos.push({ x, y });
    comandoAnterior = comando;
  }

  return pontos;
}

export function limitesDoCaminho(d: string): Limites {
  const pontos = pontosDoCaminho(d);
  if (pontos.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return {
    minX: Math.min(...pontos.map((p) => p.x)),
    minY: Math.min(...pontos.map((p) => p.y)),
    maxX: Math.max(...pontos.map((p) => p.x)),
    maxY: Math.max(...pontos.map((p) => p.y)),
  };
}

/** Se o desenho cabe na grade, com uma folga pequena para arredondamento. */
export function cabeNaGrade(d: string, grade = 24, folga = 0.5): boolean {
  const { minX, minY, maxX, maxY } = limitesDoCaminho(d);
  return (
    minX >= -folga && minY >= -folga && maxX <= grade + folga && maxY <= grade + folga
  );
}
