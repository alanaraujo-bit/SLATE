"use client";

import { useEffect, useRef, useState } from "react";
import { Botao, Rotulo, Superficie } from "@slate/design-system";
import { api, mensagemDoErro } from "@/lib/api";
import {
  esquecerPedidoPareamento,
  guardarParConfiavel,
  guardarPedidoPareamento,
  lerPedidoPareamento,
  obterOuCriarIdentidade,
} from "@/lib/identidade-local";
import { LeitorQr } from "./leitor-qr";

interface CodigoAtivo {
  pedidoId: string;
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
  aoParear,
  aoLerConvite,
  aoCancelar,
}: {
  aoParear: () => void;
  aoLerConvite: (token: string) => void;
  aoCancelar?: () => void;
}) {
  const [codigo, setCodigo] = useState<CodigoAtivo | null>(null);
  const [restante, setRestante] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [lendoQr, setLendoQr] = useState(false);
  const consultando = useRef(false);

  useEffect(() => {
    void lerPedidoPareamento().then((pedido) => {
      if (pedido) setCodigo(pedido);
    });
  }, []);

  // Contagem regressiva do código.
  useEffect(() => {
    if (!codigo) return;

    const atualizar = () => {
      const segundos = Math.max(0, Math.ceil((codigo.expiraEm - Date.now()) / 1000));
      setRestante(segundos);
      if (segundos === 0) {
        setCodigo(null);
        void esquecerPedidoPareamento();
      }
    };

    atualizar();
    const timer = setInterval(atualizar, 1000);
    return () => clearInterval(timer);
  }, [codigo]);

  /*
   * Enquanto há código na tela, verifica se o computador já confirmou.
   *
   * É consulta periódica de propósito: o canal WebRTC só nasce depois que a
   * cerimônia confirma qual chave do Agente é confiável. Só roda enquanto o
   * código está visível, então não há tráfego de fundo quando a tela está parada.
   */
  useEffect(() => {
    if (!codigo) return;

    const verificar = async () => {
      if (consultando.current) return;
      consultando.current = true;

      try {
        const resultado = await api.consultarPedidoPareamento(codigo.pedidoId);
        if (resultado.ok && resultado.dados.situacao === "confirmado") {
          await guardarParConfiavel(resultado.dados.agente);
          await esquecerPedidoPareamento();
          setCodigo(null);
          aoParear();
        } else if (
          resultado.ok &&
          ["expirado", "bloqueado"].includes(resultado.dados.situacao)
        ) {
          await esquecerPedidoPareamento();
          setCodigo(null);
        }
      } finally {
        consultando.current = false;
      }
    };

    const timer = setInterval(verificar, 3000);
    return () => clearInterval(timer);
  }, [codigo, aoParear]);

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

      const pedido = {
        pedidoId: resultado.dados.pedidoId,
        codigo: resultado.dados.codigo,
        codigoFormatado: resultado.dados.codigoFormatado,
        expiraEm: new Date(resultado.dados.expiraEm).getTime(),
      };
      await guardarPedidoPareamento(pedido);
      setCodigo(pedido);
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

          <Botao
            onClick={() => {
              setCodigo(null);
              void esquecerPedidoPareamento();
            }}
          >
            Cancelar
          </Botao>
        </div>
      </Superficie>
    );
  }

  if (lendoQr) {
    return (
      <Superficie nivel="elevada" preenchida>
        <LeitorQr
          aoLer={aoLerConvite}
          aoCancelar={() => setLendoQr(false)}
        />
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

        <div className="pareamento__opcoes">
          <Botao tom="acento" tamanho="lg" onClick={() => setLendoQr(true)}>
            Ler QR Code
          </Botao>
          <Botao
            tamanho="lg"
            estado={pedindo ? "loading" : "idle"}
            onClick={pedir}
          >
            Usar código de 6 dígitos
          </Botao>
          {aoCancelar && <Botao onClick={aoCancelar}>Cancelar</Botao>}
        </div>
      </div>
    </Superficie>
  );
}
