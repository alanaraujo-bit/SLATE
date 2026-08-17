import { useEffect, useRef, type ReactNode } from "react";
import { Botao } from "@slate/design-system";

/**
 * Diálogo do Agente.
 *
 * Usa o `<dialog>` do próprio navegador, e não uma `div` sobreposta. O
 * elemento nativo já traz o que uma reimplementação erra em silêncio: foco
 * preso dentro do diálogo, `Esc` fechando, o resto da página inerte para
 * leitor de tela e a camada de topo acima de qualquer `z-index`.
 *
 * O que ele **não** traz é fechar ao clicar fora, e isso é acrescentado abaixo
 * comparando o alvo do clique com a caixa do próprio diálogo — a área do
 * backdrop pertence ao elemento, então um clique nela chega com `target` sendo
 * o próprio `<dialog>`.
 */
export function Modal({
  aberto,
  titulo,
  descricao,
  aoFechar,
  children,
  acoes,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  aoFechar: () => void;
  children?: ReactNode;
  acoes?: ReactNode;
}) {
  const caixa = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = caixa.current;
    if (!dialogo) return;

    if (aberto && !dialogo.open) {
      // `showModal`, e não `show`: é o que torna o resto inerte e prende o
      // foco. Com `show` a pessoa navega para trás do diálogo pelo teclado.
      dialogo.showModal();
    } else if (!aberto && dialogo.open) {
      dialogo.close();
    }
  }, [aberto]);

  useEffect(() => {
    const dialogo = caixa.current;
    if (!dialogo) return;
    // `Esc` fecha por conta do navegador, sem passar por este componente. Sem
    // ouvir o evento, o estado de quem nos usa ficaria dizendo "aberto" com o
    // diálogo já fechado — e a segunda abertura não aconteceria.
    const aoCancelar = () => aoFechar();
    dialogo.addEventListener("close", aoCancelar);
    return () => dialogo.removeEventListener("close", aoCancelar);
  }, [aoFechar]);

  return (
    <dialog
      ref={caixa}
      className="modal"
      aria-labelledby="modal-titulo"
      onClick={(evento) => {
        // Clique no backdrop: o alvo é o próprio `<dialog>`, porque a caixa
        // interna intercepta os cliques de dentro.
        if (evento.target === caixa.current) aoFechar();
      }}
    >
      <div className="modal__caixa">
        <h2 id="modal-titulo" className="modal__titulo">
          {titulo}
        </h2>
        {descricao && <p className="modal__descricao">{descricao}</p>}
        {children}
        <div className="modal__acoes">
          {acoes ?? (
            <Botao onClick={aoFechar} tamanho="md">
              Fechar
            </Botao>
          )}
        </div>
      </div>
    </dialog>
  );
}
