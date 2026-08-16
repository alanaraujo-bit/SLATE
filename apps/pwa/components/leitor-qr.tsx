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

      /*
       * Confere que o decodificador existe, e não só que a câmera abriu.
       *
       * São duas coisas diferentes, e confundi-las custou caro: a câmera subia
       * normalmente enquanto o Worker de decodificação era recusado pela CSP,
       * e o resultado era uma imagem ao vivo que nunca lia nada — sem erro,
       * porque a falha mora numa promessa interna da biblioteca. Melhor dizer
       * que não dá para ler do que deixar a pessoa mirando o QR para sempre.
       */
      await QrScanner.createQrEngine();

      setAtivo(true);
    } catch {
      setErro(
        "Não foi possível ler pela câmera neste aparelho. Escolha uma foto do QR Code ou use o código de 6 dígitos.",
      );
      scanner.current?.destroy();
      scanner.current = null;
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
