import { Superficie } from "@slate/design-system";

export const metadata = { title: "SLATE — sem conexão" };

/**
 * Tela servida pelo service worker quando não há rede nem nada em cache.
 *
 * Existe para que o pior caso ainda pareça a aplicação, e não o erro de rede
 * do navegador. A diferença importa: a tela do navegador sugere que o SLATE
 * está fora do ar, quando o que está fora é a rede do aparelho.
 */
export default function Offline() {
  return (
    <div className="app">
      <header className="app__cabecalho">
        <div className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="marca__simbolo" src="/icons/icon-192.png" alt="" />
          SLATE
        </div>
      </header>

      <main className="app__corpo">
        <Superficie nivel="elevada" preenchida>
          <div className="aviso">
            <h1 className="aviso__titulo">Sem conexão</h1>
            <p className="aviso__texto">
              Este aparelho está sem rede. O SLATE volta a funcionar assim que a
              conexão retornar — não é preciso fazer nada.
            </p>
          </div>
        </Superficie>
      </main>
    </div>
  );
}
