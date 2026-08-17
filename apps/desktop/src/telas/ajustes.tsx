import { invoke } from "@tauri-apps/api/core";
import { Botao, Rotulo } from "@slate/design-system";
import { InicioAutomatico } from "../inicio-automatico";
import { Atualizador } from "../atualizador";
import { TEMAS, type Tema } from "../tema";
import type { Situacao } from "../tipos";

export function TelaAjustes({
  situacao,
  tema,
  aoEscolherTema,
  aoSair,
}: {
  situacao: Situacao;
  tema: Tema;
  aoEscolherTema: (tema: Tema) => void;
  aoSair: () => void;
}) {
  return (
    <section className="tela">
      <header className="tela__topo">
        <div>
          <h1 className="tela__titulo">Ajustes</h1>
          <Rotulo tom="atenuado">Preferências deste computador.</Rotulo>
        </div>
      </header>

      <div className="cartao">
        <div className="cartao__cabecalho">
          <h2>Aparência</h2>
          <Rotulo tamanho="xs" tom="sutil">
            O padrão acompanha o Windows.
          </Rotulo>
        </div>
        <div className="temas" role="radiogroup" aria-label="Tema">
          {TEMAS.map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              role="radio"
              aria-checked={tema === opcao.valor}
              className={`tema-opcao${tema === opcao.valor ? " ativa" : ""}`}
              onClick={() => aoEscolherTema(opcao.valor)}
            >
              <span className={`tema-amostra tema-amostra--${opcao.valor}`} aria-hidden />
              <span className="tema-opcao__nome">{opcao.rotulo}</span>
              <span className="tema-opcao__descricao">{opcao.descricao}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cartao">
        <div className="cartao__cabecalho">
          <h2>Inicialização</h2>
        </div>
        <InicioAutomatico />
      </div>

      <div className="cartao">
        <div className="cartao__cabecalho">
          <h2>Atualizações</h2>
        </div>
        <Atualizador />
      </div>

      <div className="cartao">
        <div className="cartao__cabecalho">
          <h2>Conta</h2>
        </div>
        <div className="linha">
          <div>
            <p className="cartao__valor">{situacao.usuario?.email}</p>
            <Rotulo tamanho="xs" tom="sutil">
              Sair não remove este computador da conta, e os aparelhos pareados
              continuam pareados.
            </Rotulo>
          </div>
          <Botao
            tom="perigo"
            onClick={() => {
              void invoke("sair").then(aoSair);
            }}
          >
            Sair
          </Botao>
        </div>
      </div>
    </section>
  );
}
