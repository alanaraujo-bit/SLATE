"use client";

import { useEffect, useState } from "react";
import { Botao, Rotulo, Superficie } from "@slate/design-system";
import { api, mensagemDoErro } from "@/lib/api";
import { guardarParConfiavel, obterOuCriarIdentidade } from "@/lib/identidade-local";

interface Convite {
  conviteId: string;
  expiraEm: string;
  agente: { id: string; nome: string };
}

export function ConvitePareamentoQr({
  token,
  aoConcluir,
  aoCancelar,
}: {
  token: string;
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const [convite, setConvite] = useState<Convite | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void api.visualizarConviteQr(token).then((resultado) => {
      if (!ativo) return;
      if (resultado.ok) setConvite(resultado.dados);
      else setErro(mensagemDoErro(resultado.erro));
    });
    return () => {
      ativo = false;
    };
  }, [token]);

  const confirmar = async () => {
    if (!convite || confirmando) return;
    setConfirmando(true);
    setErro(null);
    try {
      const identidade = await obterOuCriarIdentidade();
      const resultado = await api.aceitarConviteQr({
        token,
        chavePublica: identidade.chavePublicaExportada,
        algoritmo: identidade.algoritmo,
        nome: identidade.nome,
      });
      if (!resultado.ok) {
        setErro(mensagemDoErro(resultado.erro));
        return;
      }
      await guardarParConfiavel(resultado.dados.agente);
      aoConcluir();
    } catch {
      setErro("Não foi possível concluir o pareamento agora.");
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <Superficie nivel="elevada" preenchida>
      <div className="convite-qr">
        <div className="convite-qr__icone" aria-hidden="true">✓</div>
        <h1 className="aviso__titulo">Conectar este aparelho?</h1>
        {convite ? (
          <>
            <p className="aviso__texto">
              Você está conectando este aparelho ao computador
              <strong> {convite.agente.nome}</strong>.
            </p>
            <Rotulo tamanho="xs" tom="sutil">
              O QR Code vale uma vez e expira automaticamente.
            </Rotulo>
            {erro && <p className="conta__erro" role="alert">{erro}</p>}
            <div className="convite-qr__acoes">
              <Botao
                tom="acento"
                tamanho="lg"
                estado={confirmando ? "loading" : "idle"}
                onClick={() => void confirmar()}
              >
                Conectar ao {convite.agente.nome}
              </Botao>
              <Botao onClick={aoCancelar}>Cancelar</Botao>
            </div>
          </>
        ) : erro ? (
          <>
            <p className="conta__erro" role="alert">{erro}</p>
            <Botao onClick={aoCancelar}>Voltar ao SLATE</Botao>
          </>
        ) : (
          <Rotulo tom="atenuado">Verificando o QR Code…</Rotulo>
        )}
      </div>
    </Superficie>
  );
}
