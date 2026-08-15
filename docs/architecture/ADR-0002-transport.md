# ADR-0002 — Transport: WebRTC DataChannel with cloud signaling

**Status:** ACCEPTED (validated by research gate, 2026-08-15)
**Supersedes:** nothing
**Mandate refs:** §12 (pairing/connectivity), §13 (security), §7 (PWA non-negotiable)

## Context

The SLATE PWA is served over HTTPS from Vercel. It must reach a Desktop Agent
running on the user's Windows machine, ideally on the same LAN, with low latency.
Mandate §12 forbids making the user type an IP, port, or token, and explicitly
demands a *technical validation gate* before freezing the protocol.

This ADR is the output of that gate.

## The obvious design does not work

The intuitive approach — Agent opens a local WebSocket server, PWA connects to
`ws://192.168.1.x:port` — fails on three independent counts:

1. **Mixed content.** An HTTPS page cannot open a `ws://` connection. Browsers
   block it outright.
2. **TLS is unobtainable.** Upgrading to `wss://` requires a certificate valid
   for a private IP literal. No public CA issues these. Shipping a bundled
   private key with a trusted-root install is a security anti-pattern and a
   malware-scanner magnet.
3. **Local Network Access is closing.** Chrome 138 introduced the LNA check
   behind a flag; **Chrome 142 launched the permission prompt**. Requests from
   public sites to `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`, `fe80::/10`,
   loopback and `.local` are now gated. WebSocket/WebTransport/WebRTC local
   connections are documented as *not yet* gated but explicitly planned. Building
   the primary transport on a mechanism scheduled for restriction is
   irresponsible for a commercial product.

## Decision

**Primary transport: WebRTC DataChannel, negotiated through a cloud signaling
service, preferring a direct LAN path, falling back to TURN relay.**

Rationale, point by point against the failures above:

- WebRTC is **not subject to mixed-content rules**. An HTTPS page may establish
  a peer connection to a peer on the local network.
- WebRTC mandates **DTLS**; the channel is encrypted end-to-end by construction.
  We never hand-roll transport crypto, and never need a CA-issued cert for a
  private IP.
- **mDNS obfuscation is not a blocker here, because of asymmetry.** Browsers
  replace their *own* host candidates with random `<uuid>.local` names to avoid
  leaking the user's local IP to arbitrary web pages. The Desktop Agent is a
  *native* application under no such constraint: it gathers and advertises its
  real LAN host candidate. ICE only needs one side to offer a reachable
  candidate, so the browser connects directly to the Agent. The privacy
  mechanism that breaks browser-to-browser LAN connections does not break
  browser-to-native.

### Path selection

```
PWA ──── SDP/ICE via signaling (WSS, cloud) ────► Desktop Agent
    ◄─────────── DataChannel (DTLS) ───────────►
                  ▲                    ▲
            host candidate       relay candidate
            (same LAN, direct)   (TURN, fallback)
```

ICE naturally prefers the lower-latency direct path and falls back transparently.
Both cases are the same code path in the application layer — the app sees one
`RTCDataChannel` regardless. This satisfies §12's "preference for direct
low-latency path, transparent fallback".

### Signaling

A persistent WSS service (Railway). It brokers SDP offers/answers and ICE
candidates between an authenticated account's paired devices. It sees only
encrypted-session setup metadata, never control traffic or its payloads. Signaling
is a rendezvous, not a data path.

### Pairing

Account-mediated rendezvous, not network discovery (§12: never invent a
discovery mechanism browsers don't support — mDNS browsing is not available to
web pages at all). The Agent authenticates to the account; the PWA authenticates
to the same account; the Agent appears in the PWA's device list. Cryptographic
device identity and the pairing handshake are specified in
[ADR-0004 Security](./ADR-0004-security.md).

## Consequences

**Positive**
- No mixed-content or certificate problem, ever.
- Encryption is mandatory and standard rather than bespoke.
- Direct LAN latency in the common case; still works across networks via relay.
- Survives the LNA rollout — we do not depend on unrestricted local access.

**Negative / accepted costs**
- Higher implementation complexity than a plain WebSocket. ICE, renegotiation,
  and reconnection are real work.
- Requires a signaling service to be reachable for *initial* connection. A
  session already established survives signaling downtime.
- TURN relay carries bandwidth cost when direct fails (symmetric NAT, isolated
  guest VLANs, AP client isolation). Tracked as a cost line; relay is expected to
  be the minority path since the target scenario is same-LAN.
- Rust-side WebRTC (`webrtc-rs` / `str0m`) is a heavier dependency than a
  WebSocket server.

**Deliberately deferred**
- If WebRTC proves unreliable on some target browser, a signaling-relayed
  WebSocket path is the escape hatch — higher latency, but the application
  protocol in `packages/protocol` is transport-agnostic precisely so this
  substitution stays cheap. This is why the protocol layer does not assume
  DataChannel semantics.

## Validation performed

- Chrome LNA rollout status and gating scope — confirmed via Chrome for
  Developers, Chrome 142 launch.
- mDNS ICE candidate behaviour and its browser-only applicability — confirmed via
  WICG/IETF material and browser bug trackers.

## References

- <https://developer.chrome.com/blog/local-network-access>
- <https://github.com/WICG/local-network-access/blob/main/explainer.md>
- <https://datatracker.ietf.org/meeting/103/materials/slides-103-rtcweb-mdns-ice-candidates-00>
- <https://bloggeek.me/psa-mdns-and-local-ice-candidates-are-coming/>
