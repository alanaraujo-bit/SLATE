# ADR-0001 — System architecture and repository shape

**Status:** ACCEPTED
**Mandate refs:** §8, §14, §19, §33

## Context

SLATE is four cooperating pieces of software — a mobile PWA, a Windows desktop
agent, cloud services, and an internal development control centre — that share
one protocol, one design language, and one data model. They ship on different
cadences.

## Decision

### Single repository, pnpm workspaces

```
apps/
  pwa               SLATE PWA — the control surface (Next.js, Vercel)
  control-center    Development Control Center / Roadmap Live (Next.js, Vercel)
  desktop           Windows Desktop Agent (Tauri + React + Rust core)
services/
  signaling         WebRTC signaling + relay (Node, Railway) — added when needed
packages/
  protocol          Wire contracts, message schemas, protocol version
  design-system     Tokens and primitives shared by PWA and desktop
  db                Schema and migrations (Drizzle, Postgres)
  roadmap-cli       Internal CLI that mutates roadmap state (§24)
```

A single repository is chosen because `packages/protocol` is consumed by three
independent clients that must never drift. Cross-repo contract synchronisation is
the failure mode this shape exists to prevent. Mandate §33 warns against
premature microservices; workspaces give module boundaries without distribution
boundaries.

### Runtime placement

| Concern | Where | Why |
|---|---|---|
| PWA, Control Center, HTTP APIs | Vercel | Static+SSR edge distribution, preview deployments per branch (§16) |
| Postgres | Railway | Persistent state; the mandate's stated preference (§34) |
| Signaling / relay | Railway | Long-lived stateful WS connections and TURN coordination |
| Windows integration | Desktop Agent | Only place with OS access |

**Signaling is deliberately not created yet.** Mandate §19 forbids provisioning
services before they are needed. The Control Center needs Postgres and Vercel and
nothing else; the signaling service is provisioned when the pairing milestone
begins. Note that Vercel Functions now support WebSockets on Fluid Compute, so
signaling placement will be re-evaluated at that milestone rather than assumed —
the deciding factor is connection lifetime and cost, not capability.

### Desktop Agent: Tauri + Rust

Validated, not assumed. Tauri gives a small installer, a real native
process for Win32 access, and a webview UI that can reuse `design-system`. The
Rust core is where process observation, the Action Engine, and the WebRTC peer
live. Toolchain verified locally: `cargo` builds and links via MSVC.

The alternative considered was Electron — rejected on installer size and memory
footprint for an always-resident background agent, which is precisely the profile
where those costs are least acceptable.

## Consequences

- One `pnpm install`, one type system, one lint config.
- Protocol changes are atomic across clients within a commit.
- Vercel projects deploy from subdirectories of one repo; each project sets its
  own root directory.
- Requires discipline: workspace packages must not import each other circularly.
