<div align="center">

# SLATE

**Turn any phone or tablet into an intelligent, contextual control surface for your computer.**

_SLATE by Aionix — a product of Aionixdev_

</div>

---

## What SLATE is

Your phone stops being a second screen and becomes an operational extension of
your PC. SLATE understands what you are doing — which application has focus,
which game is running, which branch you are on — and presents the right controls
without being asked.

It is not a grid of buttons. It is a platform: a context engine, an action
engine, and a bidirectional state channel, with control surfaces on top.

## Architecture at a glance

```
        ┌──────────────┐   WebRTC DataChannel (DTLS)   ┌────────────────┐
        │  SLATE PWA   │◄─────────── direct ──────────►│ Desktop  Agent │
        │  phone/tablet│                                │    Windows     │
        └──────┬───────┘                                └───────┬────────┘
               │            ┌───────────────────┐               │
               └───────────►│    Signaling      │◄──────────────┘
                            │   SDP / ICE only  │
                            └───────────────────┘
```

Transport is WebRTC rather than a LAN WebSocket for reasons that are not
obvious — see [ADR-0002](./docs/architecture/ADR-0002-transport.md). The short
version: an HTTPS page cannot open `ws://`, no CA will certify a private IP, and
Chrome 142 began gating local network access. WebRTC sidesteps all three.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/pwa` | The SLATE control surface (PWA) |
| `apps/control-center` | Development Control Center — live roadmap |
| `apps/desktop` | Windows Desktop Agent (Tauri + Rust) |
| `packages/protocol` | Wire contracts shared by every client |
| `packages/design-system` | Design tokens and primitives |
| `packages/db` | Postgres schema and migrations |
| `packages/roadmap-cli` | Internal CLI driving roadmap state |

## Documentation

- [Architecture decisions](./docs/architecture/) — why things are the way they are
- [Operator actions](./docs/operator/OPERATOR_ACTIONS.md) — what needs a human
- [Blockers](./docs/operator/BLOCKERS.md)

## Development

```bash
pnpm install
```

SLATE is cloud-first by mandate: there is no local database, no container to
start, and no localhost workflow required to work on it. Validation happens
against real preview deployments.

---

© Aionixdev. All rights reserved.
