"use client";

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";

export type LinkState = "live" | "reconnecting" | "offline";

/**
 * Grace period before a dropped stream is reported to the user.
 *
 * EventSource reconnects on its own, and our stream deliberately rolls over
 * every few minutes. Surfacing every gap would make a healthy page look
 * unstable, so a brief interruption stays silent and only a genuinely stuck
 * connection is announced.
 */
const GRACE_MS = 6000;
const OFFLINE_MS = 30_000;

export function useLiveSnapshot(initial: Snapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [link, setLink] = useState<LinkState>("live");
  const lastMessageAt = useRef(Date.now());
  const openRef = useRef(false);

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource("/api/stream");

      source.addEventListener("open", () => {
        openRef.current = true;
        lastMessageAt.current = Date.now();
        setLink("live");
      });

      source.addEventListener("snapshot", (event) => {
        lastMessageAt.current = Date.now();
        openRef.current = true;
        setLink("live");
        try {
          setSnapshot(JSON.parse((event as MessageEvent<string>).data) as Snapshot);
        } catch {
          /* a malformed frame is not worth tearing the page down over */
        }
      });

      // An expected end of stream. Reconnect immediately and stay "live" — the
      // user has no reason to hear about our function time limits.
      source.addEventListener("rollover", () => {
        lastMessageAt.current = Date.now();
        source?.close();
        if (!disposed) connect();
      });

      source.addEventListener("degraded", () => {
        setLink("reconnecting");
      });

      source.addEventListener("error", () => {
        openRef.current = false;
        // EventSource retries by itself; only report if the gap persists.
        const silentFor = Date.now() - lastMessageAt.current;
        if (silentFor > OFFLINE_MS) setLink("offline");
        else if (silentFor > GRACE_MS) setLink("reconnecting");
      });
    };

    connect();

    const monitor = setInterval(() => {
      const silentFor = Date.now() - lastMessageAt.current;
      if (openRef.current && silentFor < OFFLINE_MS) return;
      if (silentFor > OFFLINE_MS) setLink("offline");
      else if (silentFor > GRACE_MS) setLink("reconnecting");
    }, 2000);

    return () => {
      disposed = true;
      clearInterval(monitor);
      source?.close();
    };
  }, []);

  return { snapshot, link };
}
