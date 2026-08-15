import { Superficie } from "@slate/design-system";
import { EstadoDaConexao } from "@/components/estado-da-conexao";

/**
 * Tela inicial.
 *
 * Enquanto o pareamento e o transporte não existem, esta tela mostra
 * honestamente o estado em que a aplicação está: sem computador pareado. Não
 * há controles de mentira nem "em breve" — o mandato §59 proíbe substituir
 * escopo prometido por promessa, e uma grade de botões que não faz nada seria
 * exatamente isso.
 */
export default function Page() {
  return (
    <div className="app">
      <header className="app__cabecalho">
        <div className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="marca__simbolo" src="/icons/icon-192.png" alt="" />
          SLATE
        </div>
        <EstadoDaConexao />
      </header>

      <main className="app__corpo">
        <Superficie nivel="elevada" preenchida>
          <div className="aviso">
            <h1 className="aviso__titulo">Nenhum computador pareado</h1>
            <p className="aviso__texto">
              Instale o SLATE no seu computador e faça o pareamento para começar a
              controlá-lo daqui.
            </p>
          </div>
        </Superficie>
      </main>
    </div>
  );
}
