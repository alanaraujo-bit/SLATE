import { loadSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** How often to check whether roadmap state changed. */
const POLL_MS = 2500;

/**
 * Close well before the platform's 300s function ceiling.
 *
 * Being cut off mid-stream by the platform surfaces to EventSource as an error,
 * which would make a perfectly healthy page blink "reconnecting" every five
 * minutes. Ending deliberately — and telling the client it was deliberate —
 * keeps the reconnect invisible.
 */
const LIFETIME_MS = 240_000;

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const startedAt = Date.now();

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const comment = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", finish);

      // Ask the browser to reconnect quickly after a clean end.
      controller.enqueue(encoder.encode("retry: 1000\n\n"));

      let lastRevision = "";
      let lastHeartbeat = Date.now();

      try {
        while (!closed && !request.signal.aborted) {
          if (Date.now() - startedAt > LIFETIME_MS) {
            // Signals an expected rollover rather than a fault, so the client
            // can reconnect without reporting a connection problem.
            send("rollover", { reason: "stream lifetime reached" });
            break;
          }

          try {
            const snapshot = await loadSnapshot();
            if (snapshot.revision !== lastRevision) {
              lastRevision = snapshot.revision;
              send("snapshot", snapshot);
              lastHeartbeat = Date.now();
            } else if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
              comment("keep-alive");
              lastHeartbeat = Date.now();
            }
          } catch (error) {
            send("degraded", {
              message: error instanceof Error ? error.message : "Unknown error",
            });
          }

          await sleep(POLL_MS, request.signal);
        }
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Prevents proxy buffering, which would otherwise defeat streaming.
      "X-Accel-Buffering": "no",
    },
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}
