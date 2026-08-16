"use client";

import { useEffect, useRef, useState } from "react";
import { Botao, Rotulo } from "@slate/design-system";

export function extrairTokenConviteQr(valor: string, origem: string): string | null {
  try {
    const url = new URL(valor);
    if (url.origin !== origem) return null;
    const token = new URLSearchParams(url.hash.slice(1)).get("convite");
    return token && token.length >= 32 && token.length <= 256 ? token : null;
  } catch {
    return null;
  }
}

export function LeitorQr({
  aoLer,
  aoCancelar,
}: {
  aoLer: (token: string) => void;
  aoCancelar: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<import("qr-scanner").default | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [ativo, setAtivo] = useState(false);

  const concluir = (conteudo: string) => {
    const token = extrairTokenConviteQr(conteudo, window.location.origin);
    if (!token) {
      setErro("Este não é um QR Code de pareamento do SLATE.");
      return;
    }
    scanner.current?.stop();
    aoLer(token);
  };

  const iniciar = async () => {
    if (!video.current || iniciando) return;
    setIniciando(true);
    setErro(null);
    try {
      const { default: QrScanner } = await import("qr-scanner");
      const leitor = new QrScanner(
        video.current,
        (resultado) => concluir(resultado.data),
        {
          preferredCamera: "environment",
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 10,
        },
      );
      scanner.current = leitor;
      await leitor.start();
      setAtivo(true);
    } catch {
      setErro(
        "Não foi possível abrir a câmera. Autorize o acesso ou escolha uma foto do QR Code.",
      );
    } finally {
      setIniciando(false);
    }
  };

  const lerArquivo = async (arquivo?: File) => {
    if (!arquivo) return;
    setErro(null);
    try {
      const { default: QrScanner } = await import("qr-scanner");
      const resultado = await QrScanner.scanImage(arquivo, {
        returnDetailedScanResult: true,
      });
      concluir(resultado.data);
    } catch {
      setErro("Não encontramos um QR Code válido nessa imagem.");
    }
  };

  useEffect(
    () => () => {
      scanner.current?.destroy();
      scanner.current = null;
    },
    [],
  );

  return (
    <section className="leitor-qr" aria-label="Leitor de QR Code">
      <div className={ativo ? "leitor-qr__camera ativa" : "leitor-qr__camera"}>
        {/*
          `autoPlay` junto com `playsInline` e `muted`: é a combinação que os
          navegadores de celular exigem para tocar sem toque na tela. Sem ela o
          leitor abria a câmera, o indicador acendia e a imagem ficava parada no
          primeiro quadro — preto.
        */}
        <video ref={video} autoPlay playsInline muted aria-label="Imagem da câmera" />
        <span>
          {iniciando ? "Abrindo a câmera…" : "A câmera só abre quando você autorizar."}
        </span>
      </div>
      <Rotulo tamanho="sm" tom="atenuado">
        Aponte para o QR Code exibido no computador.
      </Rotulo>
      {erro && <p className="conta__erro" role="alert">{erro}</p>}
      {!ativo && (
        <Botao
          tom="acento"
          tamanho="lg"
          estado={iniciando ? "loading" : "idle"}
          onClick={() => void iniciar()}
        >
          Abrir câmera
        </Botao>
      )}
      <label className="botao-arquivo">
        Escolher foto do QR Code
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(evento) => void lerArquivo(evento.target.files?.[0])}
        />
      </label>
      <Botao onClick={aoCancelar}>Usar código de 6 dígitos</Botao>
    </section>
  );
}
