# SLATE — Decision Log

Chronological index of decisions taken autonomously during execution, per
mandate §50. Substantial architectural decisions are written up in full as ADRs
under [`docs/architecture/`](../architecture/); this file is the index and the
home for decisions too small to warrant an ADR.

---

## 2026-08-15

### D-001 — Single repository with pnpm workspaces
→ [ADR-0001](../architecture/ADR-0001-system-architecture.md)
Three clients consume one protocol package; cross-repo contract drift is the
failure mode being designed out.

### D-002 — WebRTC DataChannel as primary transport
→ [ADR-0002](../architecture/ADR-0002-transport.md)
**The most consequential decision made so far.** The intuitive LAN-WebSocket
design is not viable: mixed content blocks `ws://` from an HTTPS page, no CA
issues certificates for private IP literals, and Chrome 142 shipped Local
Network Access gating. WebRTC is exempt from mixed-content rules and encrypts
via DTLS by construction.

### D-003 — Tauri over Electron for the Desktop Agent
→ [ADR-0001](../architecture/ADR-0001-system-architecture.md)
Installer size and resident memory dominate for an always-on background agent.
Rust/MSVC toolchain verified working on the target machine before committing.

### D-004 — Signaling service not provisioned yet
Mandate §19 forbids provisioning ahead of need. The Control Center requires
Postgres and Vercel only. Signaling is provisioned when the pairing milestone
starts, at which point Vercel Functions' WebSocket support is re-evaluated
against Railway on connection lifetime and cost rather than assumed either way.

### D-005 — Roadmap state lives in Postgres, not in the repository
Mandate §23 requires computed progress, §24 requires programmatic mutation
without manual page edits, and §25 requires realtime updates without a refresh.
A JSON file rendered at build time fails all three — it would require a redeploy
to reflect a status change. Roadmap state is therefore relational data with an
internal CLI as the write path and SSE as the read path.

### D-007 — The Control Center runs locally, not hosted — **operator decision**
The mandate (§14, §21) placed the Development Control Center on Vercel. The
operator overrode this during execution, on two grounds: a roadmap page that
needs a deploy to reflect a status change defeats the purpose of it being live,
and the Control Center is a temporary instrument that will not exist once SLATE
ships — so hosting it is waste.

It now runs locally (`pnpm roadmap:ui`) against the **cloud** Postgres that
holds roadmap state. Nothing about the data model, the CLI write path, or the
progress computation changed; only where the reader process runs. Realtime is
strictly better locally: with no serverless function ceiling, the SSE stream
holds one connection instead of rolling over every four minutes.

This does not relax §14 for the product itself. The PWA and its services remain
cloud-first; only this internal tool is local.

### D-008 — Vercel deployments blocked; Control Center unblocked by D-007
Deployments to `slate-control-center` stalled indefinitely: the first build
succeeded in 44s, and every subsequent deployment — CLI, git-triggered, and
`--prebuilt` alike — was created but never started building, with no build
logs and `promote` reporting "not ready". Ruled out: build queue contention
(cleared, recurred immediately), stale CLI (upgraded 58→59, unchanged),
and the build itself (`vercel build` succeeds locally, and the identical source
builds and runs in Docker).

The cause is account- or platform-side and is recorded as
[ACTION-003](./OPERATOR_ACTIONS.md). It no longer blocks anything, since D-007
removed the need to host this application at all — but it must be resolved
before the PWA ships, and is therefore left open rather than closed.

### D-006 — CI definitions staged outside `.github/workflows/`
Pushing workflow files is rejected by the current token scope. Rather than defer
authoring CI, definitions are written and version-controlled under
`docs/deployment/ci/` and relocated once [ACTION-001](./OPERATOR_ACTIONS.md)
resolves. The work is done; only its activation waits.
