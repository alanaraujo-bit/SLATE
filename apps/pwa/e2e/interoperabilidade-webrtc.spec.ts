import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const pastaRust = fileURLToPath(new URL("../../desktop/src-tauri", import.meta.url));

function primeiraLinha(processo: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    const linhas = createInterface({ input: processo.stdout });
    linhas.once("line", resolve);
    processo.once("error", reject);
    processo.once("exit", (codigo) => {
      if (codigo !== null && codigo !== 0) reject(new Error(`sonda Rust encerrou com ${codigo}`));
    });
  });
}

function conclusao(processo: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let erros = "";
    processo.stderr.on("data", (parte) => (erros += parte.toString()));
    processo.once("error", reject);
    processo.once("exit", (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`sonda Rust encerrou com ${codigo}\n${erros}`));
    });
  });
}

test("Chromium e Agente Rust negociam a sessão e concluem uma ação", async (
  { page },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "celular", "uma execução real cobre os dois layouts");
  test.setTimeout(120_000);

  const sonda = spawn(
    "cargo",
    ["run", "--quiet", "--offline", "--example", "interoperabilidade_webrtc"],
    { cwd: pastaRust, windowsHide: true },
  );
  const terminou = conclusao(sonda);

  try {
    // A sonda é local de propósito. Usar a origem HTTPS publicada aqui faria
    // o Chrome aplicar a permissão de acesso à rede local (ADR-0002), misturando
    // uma política do navegador com a interoperabilidade WebRTC que medimos.
    await page.goto("about:blank");
    const oferta = await page.evaluate(async () => {
      const par = new RTCPeerConnection();
      const canal = par.createDataChannel("slate", { ordered: true });
      Object.assign(window, { __slateParTeste: par, __slateCanalTeste: canal });

      await par.setLocalDescription(await par.createOffer());
      if (par.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const limite = window.setTimeout(() => reject(new Error("ICE do navegador não concluiu")), 15_000);
          par.addEventListener("icegatheringstatechange", () => {
            if (par.iceGatheringState === "complete") {
              window.clearTimeout(limite);
              resolve();
            }
          });
        });
      }
      return par.localDescription?.sdp;
    });
    expect(oferta).toBeTruthy();

    const respostaPendente = primeiraLinha(sonda);
    sonda.stdin.write(`${JSON.stringify({ sdp: oferta, servidoresIce: [] })}\n`);
    const resposta = JSON.parse(await respostaPendente) as { sdp: string };

    const recebidos = await page.evaluate(async (sdp) => {
      const estado = window as typeof window & {
        __slateParTeste: RTCPeerConnection;
        __slateCanalTeste: RTCDataChannel;
      };
      await estado.__slateParTeste.setRemoteDescription({ type: "answer", sdp });

      return new Promise<unknown[]>((resolve, reject) => {
        // Na primeira execução o Cargo ainda pode compilar a sonda. O limite é
        // do teste, não do produto; precisa comportar esse custo sem virar um
        // falso negativo de WebRTC.
        const limite = window.setTimeout(() => reject(new Error("DataChannel não abriu")), 60_000);
        const mensagens: unknown[] = [];
        estado.__slateCanalTeste.addEventListener("message", (evento) => {
          const recebido = JSON.parse(String(evento.data)) as {
            k?: string;
            p?: { executionId?: string; ok?: boolean };
          };
          mensagens.push(recebido);
          if (recebido.k === "session.hello") {
            estado.__slateCanalTeste.send(JSON.stringify({
              v: 1,
              id: "hello-superficie-browser",
              t: "evt",
              k: "session.hello",
              ts: Date.now(),
              seq: 0,
              p: {
                protocolVersion: 1,
                appVersion: "0.1.0",
                role: "surface",
                deviceId: "superficie-browser-teste",
                capabilities: [],
              },
            }));
            estado.__slateCanalTeste.send(JSON.stringify({
              v: 1,
              id: "acao-browser-1",
              t: "req",
              k: "action.execute",
              ts: Date.now(),
              seq: 1,
              p: { actionId: "midia.reproduzir-pausar" },
            }));
          }
          if (recebido.k === "action.result") {
            estado.__slateCanalTeste.send(JSON.stringify({
              k: "teste.resultado-recebido",
              p: { executionId: recebido.p?.executionId },
            }));
            window.clearTimeout(limite);
            resolve(mensagens);
          }
        });
      });
    }, resposta.sdp);

    expect(recebidos).toEqual(expect.arrayContaining([
      expect.objectContaining({
        v: 1,
        k: "session.hello",
        p: expect.objectContaining({ role: "agent", deviceId: "agente-rust-teste" }),
      }),
      expect.objectContaining({
        k: "action.execute.result",
        p: { accepted: true, executionId: "acao-browser-1" },
      }),
      expect.objectContaining({
        k: "action.result",
        p: { executionId: "acao-browser-1", ok: true, durationMs: 1 },
      }),
    ]));
    sonda.stdin.end();
    await terminou;
  } finally {
    if (sonda.exitCode === null) sonda.kill();
  }
});

declare global {
  interface Window {
    __slateParTeste?: RTCPeerConnection;
    __slateCanalTeste?: RTCDataChannel;
  }
}
