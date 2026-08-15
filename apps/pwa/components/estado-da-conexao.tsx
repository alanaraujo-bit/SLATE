import { Indicador } from "@slate/design-system";
import { descrever, type EstadoConexao, type TomEstado } from "@/lib/estados-conexao";

const SITUACAO_POR_TOM: Record<TomEstado, "ok" | "atencao" | "erro" | "neutro"> = {
  positivo: "ok",
  atencao: "atencao",
  erro: "erro",
  neutro: "neutro",
};

/**
 * Mostra o estado da ligação com o computador.
 *
 * O estado vem do ciclo de vida real do transporte. Este componente não tenta
 * inferir conectividade por conta própria; assim, "Conectado" só aparece após
 * autenticação, DTLS, DataChannel e negociação de protocolo.
 */
export function EstadoDaConexao({ estado }: { estado: EstadoConexao }) {
  const descricao = descrever(estado);

  return (
    <Indicador
      situacao={SITUACAO_POR_TOM[descricao.tom]}
      descricao={descricao.titulo}
      pulsando={descricao.tentandoSozinho}
      title={descricao.explicacao}
      data-estado={estado}
    />
  );
}
