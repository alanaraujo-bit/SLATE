"use client";

import { useCallback, useEffect, useState } from "react";
import { Botao, Rotulo, Superficie } from "@slate/design-system";
import { api, type DispositivoResumo, type Usuario } from "@/lib/api";
import { EstadoDaConexao } from "./estado-da-conexao";
import { FormularioConta } from "./formulario-conta";
import { PainelPareamento } from "./painel-pareamento";

type Situacao = "carregando" | "deslogado" | "logado" | "servidor-fora";

/**
 * Decide o que mostrar.
 *
 * Os quatro estados são explícitos, incluindo o de servidor inacessível — sem
 * ele, uma API fora do ar apareceria como tela de login, e a pessoa tentaria
 * entrar repetidamente sem entender por que nada acontece.
 */
export function Aplicacao() {
  const [situacao, setSituacao] = useState<Situacao>("carregando");
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [dispositivos, setDispositivos] = useState<DispositivoResumo[]>([]);

  const carregar = useCallback(async () => {
    // Sem rede, nem adianta perguntar. Mostrar o formulário de entrada aqui
    // levaria a pessoa a preencher e-mail e senha para receber um erro no
    // final — pior do que dizer de saída que o servidor está fora de alcance.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSituacao("servidor-fora");
      return;
    }

    const eu = await api.eu();

    if (eu.ok) {
      setUsuario(eu.dados.usuario);
      setSituacao("logado");

      const lista = await api.dispositivos();
      if (lista.ok) setDispositivos(lista.dados.dispositivos);
      return;
    }

    // 401 é resposta legítima: quer dizer que não há sessão. Já falha de rede
    // é outra coisa, e precisa ser dita de outro jeito.
    setSituacao(eu.status === 0 ? "servidor-fora" : "deslogado");
  }, []);

  useEffect(() => {
    void carregar();

    // A rede volta sozinha com frequência; quando voltar, a tela se recupera
    // sem exigir que a pessoa recarregue.
    const aoVoltar = () => void carregar();
    window.addEventListener("online", aoVoltar);
    return () => window.removeEventListener("online", aoVoltar);
  }, [carregar]);

  const sair = async () => {
    await api.sair();
    setUsuario(null);
    setDispositivos([]);
    setSituacao("deslogado");
  };

  return (
    <div className="app">
      <header className="app__cabecalho">
        <div className="marca">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="marca__simbolo" src="/icons/icon-192.png" alt="" />
          SLATE
        </div>

        <div className="app__acoes">
          <EstadoDaConexao />
          {situacao === "logado" && (
            <Botao tamanho="sm" onClick={sair}>
              Sair
            </Botao>
          )}
        </div>
      </header>

      <main className="app__corpo">
        {situacao === "carregando" && (
          <div className="aviso" aria-busy="true">
            <Rotulo tom="atenuado">Carregando…</Rotulo>
          </div>
        )}

        {situacao === "servidor-fora" && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Servidor fora de alcance</h1>
              <p className="aviso__texto">
                Não foi possível falar com o servidor do SLATE. Verifique sua
                conexão — assim que ela voltar, é só tentar de novo.
              </p>
              <Botao tom="acento" onClick={() => void carregar()}>
                Tentar de novo
              </Botao>
            </div>
          </Superficie>
        )}

        {situacao === "deslogado" && (
          <Superficie nivel="elevada" preenchida>
            <FormularioConta aoEntrar={() => void carregar()} />
          </Superficie>
        )}

        {situacao === "logado" && dispositivos.length === 0 && (
          <PainelPareamento dispositivos={dispositivos} aoParear={() => void carregar()} />
        )}

        {situacao === "logado" && dispositivos.length > 0 && (
          <Superficie nivel="elevada" preenchida>
            <div className="aviso">
              <h1 className="aviso__titulo">Dispositivos da sua conta</h1>

              <ul className="dispositivos">
                {dispositivos.map((d) => (
                  <li className="dispositivo" key={d.id}>
                    <span className="dispositivo__nome">{d.nome}</span>
                    <Rotulo tamanho="xs" tom="sutil">
                      {d.papel === "agent" ? "Computador" : "Superfície"} ·{" "}
                      {d.situacao === "ativo" ? "ativo" : d.situacao}
                    </Rotulo>
                  </li>
                ))}
              </ul>

              {/*
                Não há grade de controles aqui porque não há transporte ainda.
                Uma tela de botões que não comandam nada seria promessa
                disfarçada de produto (§59).
              */}
              <p className="aviso__texto">
                O canal de comunicação com o computador ainda está sendo construído.
                Assim que ficar pronto, os controles aparecem aqui.
              </p>
            </div>
          </Superficie>
        )}
      </main>

      {usuario && (
        <footer className="app__rodape">
          <Rotulo tamanho="2xs" tom="sutil">
            {usuario.email}
          </Rotulo>
        </footer>
      )}
    </div>
  );
}
