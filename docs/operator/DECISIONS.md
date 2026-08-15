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

### D-006 — CI definitions staged outside `.github/workflows/`
Pushing workflow files is rejected by the current token scope. Rather than defer
authoring CI, definitions are written and version-controlled under
`docs/deployment/ci/` and relocated once [ACTION-001](./OPERATOR_ACTIONS.md)
resolves. The work is done; only its activation waits.
