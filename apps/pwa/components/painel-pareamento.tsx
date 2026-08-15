"use client";

import { useEffect, useRef, useState } from "react";
import { Botao, Rotulo, Superficie } from "@slate/design-system";
import { api, mensagemDoErro, type DispositivoResumo } from "@/lib/api";
import { obterOuCriarIdentidade } from "@/lib/identidade-local";

interface CodigoAtivo {
  codigo: string;
  codigoFormatado: string;
  expiraEm: number;
}

/**
 * Pareamento visto do lado do celular.
 *
 * Este aparelho pede o pareamento e mostra um código; quem confirma é o SLATE
 * no computador. O sentido é esse porque digitar o código no PC é o que prova
 * posse da máquina — sem isso, uma senha vazada viraria controle do computador
 * (ADR-0004 §2).
 */
export function PainelPareamento({
  dispositivos,
  aoParear,
}: {
  dispositivos: DispositivoResumo[];
  aoParear: () => void;
}) {
  const [codigo, setCodigo] = useState<CodigoAtivo | null>(null);
  const [restante, setRestante] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const consultando = useRef(false);

  // Contagem regressiva do código.
  useEffect(() => {
    if (!codigo) return;

    const atualizar = () => {
      const segundos = Math.max(0, Math.ceil((codigo.expiraEm - Date.now()) / 1000));
      setRestante(segundos);
      if (segundos === 0) setCodigo(null);
    };

    atualizar();
    const timer = setInterval(atualizar, 1000);
    return () => clearInterval(timer);
  }, [codigo]);

  /*
   * Enquanto há código na tela, verifica se o computador já confirmou.
   *
   * É consulta periódica de propósito: o canal em tempo real depende do
   * transporte, que ainda não existe. Só roda enquanto o código está visível,
   * então não há tráfego de fundo quando a tela está parada — e a substituição
   * por um aviso do servidor depois não muda nada nesta tela.
   */
  useEffect(() => {
    if (!codigo) return;

    const verificar = async () => {
      if (consultando.current) return;
      consultando.current = true;

      try {
        const resultado = await api.dispositivos();
        if (resultado.ok && resultado.dados.dispositivos.length > dispositivos.length) {
          setCodigo(null);
          aoParear();
        }
      } finally {
        consultando.current = false;
      }
    };

    const timer = setInterval(verificar, 3000);
    return () => clearInterval(timer);
  }, [codigo, dispositivos.length, aoParear]);

  const pedir = async () => {
    if (pedindo) return;
    setErro(null);
    setPedindo(true);

    try {
      const identidade = await obterOuCriarIdentidade();

      const resultado = await api.pedirPareamento({
        chavePublica: identidade.chavePublicaExportada,
        algoritmo: identidade.algoritmo,
        nome: identidade.nome,
      });

      if (!resultado.ok) {
        setErro(mensagemDoErro(resultado.erro));
        return;
      }

      setCodigo({
        codigo: resultado.dados.codigo,
        codigoFormatado: resultado.dados.codigoFormatado,
        expiraEm: new Date(resultado.dados.expiraEm).getTime(),
      });
    } catch {
      setErro("Não foi possível preparar este aparelho para o pareamento.");
    } finally {
      setPedindo(false);
    }
  };

  if (codigo) {
    return (
      <Superficie nivel="elevada" preenchida>
        <div className="pareamento">
          <h2 className="pareamento__titulo">Digite este código no computador</h2>

          <p className="pareamento__codigo" aria-label={`Código ${codigo.codigo.split("").join(" ")}`}>
            {codigo.codigoFormatado}
          </p>

          <p className="pareamento__prazo" role="timer">
            {restante > 0
              ? `Expira em ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, "0")}`
              : "Código expirado"}
          </p>

          <Rotulo tamanho="sm" tom="atenuado">
            Abra o SLATE no computador e informe o código acima. Ele vale uma vez
            só.
          </Rotulo>

          <Botao onClick={() => setCodigo(null)}>Cancelar</Botao>
        </div>
      </Superficie>
    );
  }

  return (
    <Superficie nivel="elevada" preenchida>
      <div className="aviso">
        <h1 className="aviso__titulo">Nenhum computador pareado</h1>
        <p className="aviso__texto">
          Instale o SLATE no seu computador e pareie este aparelho para começar a
          controlá-lo daqui.
        </p>

        {erro && (
          <p className="conta__erro" role="alert">
            {erro}
          </p>
        )}

        <Botao
          tom="acento"
          tamanho="lg"
          estado={pedindo ? "loading" : "idle"}
          onClick={pedir}
        >
          Parear este aparelho
        </Botao>
      </div>
    </Superficie>
  );
}
