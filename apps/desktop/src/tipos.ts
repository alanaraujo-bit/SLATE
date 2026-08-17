/** Formas que atravessam a fronteira com o processo em Rust. */

export interface Usuario {
  id: string;
  email: string;
  nome: string | null;
}

export interface Dispositivo {
  id: string;
  nome: string;
  papel: string;
  situacao: string;
  online?: boolean;
}

export interface Situacao {
  conectado: boolean;
  usuario: Usuario | null;
  nomeComputador: string;
  chavePublica: string;
  dispositivos: Dispositivo[];
  /**
   * IDs autorizados a abrir programas neste computador.
   *
   * Vem da raiz de confiança local, e não da conta: é aqui que a permissão é
   * concedida e é aqui que ela é verificada (ADR-0004).
   */
  atalhosPermitidos?: string[];
}
