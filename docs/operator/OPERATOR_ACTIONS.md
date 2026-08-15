# SLATE — Operator Actions

Actions that depend exclusively on the operator (Alan / Aionixdev) and cannot be
performed autonomously. Per mandate §28, none of these halt the project; each
records precisely what it blocks.

Status values: `OPEN` · `IN_PROGRESS` · `RESOLVED` · `WONT_DO`

---

## ACTION-001 — Grant `workflow` scope to the GitHub CLI token

**STATUS:** OPEN
**PROJECT BLOCKED:** NO
**BLOCKS:** CI/CD pipeline only (GitHub Actions). All application development,
cloud deployment, and cloud validation proceed normally without it.

### Why

The authenticated `gh` token carries scopes `gist, read:org, repo`. It lacks
`workflow`. GitHub rejects any push whose diff touches `.github/workflows/**`
with `refusing to allow an OAuth App to create or update workflow`. Without this
scope, automated CI (mandate §17, §56) cannot be committed to the repository.

This is a token permission, not a paid upgrade or external contract.

### What to do

1. In the Claude Code prompt, run:

   ```
   ! gh auth refresh -h github.com -s workflow
   ```

2. A browser window opens for GitHub authorization. Approve it.
3. Confirm with `gh auth status` — scopes should now include `workflow`.

### How to validate

```
gh auth status
```
Expected: `Token scopes: 'gist', 'read:org', 'repo', 'workflow'`

### What has already been completed

Nothing depends on it being done first. CI workflow definitions are authored and
held in the repository under `docs/deployment/ci/` until the scope lands, at
which point they move to `.github/workflows/` in a single commit.

### What happens after

CI pipelines (typecheck, lint, unit, E2E against preview deployments) activate on
every push and pull request, and the roadmap quality gates begin reporting real
automated results rather than locally-executed ones.

---

## ACTION-003 — Vercel deployments never leave the queue

**STATUS:** OPEN
**PROJECT BLOCKED:** NO
**BLOCKS:** Nothing today. The Control Center runs locally by operator decision
([D-007](./DECISIONS.md)). This must be resolved before the SLATE PWA ships,
since the PWA is genuinely cloud-hosted.

### Why

On the `aionixdev` Vercel scope, project `slate-control-center` deployed
successfully exactly once (44s, `READY`). Every deployment afterwards was
created but never began building:

- status stays at a value the CLI renders as `UNKNOWN`, never `READY`
- no build logs exist — `vercel inspect --logs` returns nothing
- `vercel promote` refuses with `422 … is not ready`

Eliminated as causes:

| Hypothesis | Test | Result |
|---|---|---|
| Build queue blocked by a stuck build | Removed the stalled deployments | Recurred immediately on an empty queue |
| Stale CLI misreporting state | Upgraded 58.9.0 → 59.0.0 | Unchanged |
| Broken build / bad monorepo config | `vercel build` locally | Succeeds |
| Source or dependency fault | Same commit built in Docker | Builds and runs correctly |
| Remote build environment | `vercel deploy --prebuilt` | Also never leaves the queue |

The last row is decisive: a prebuilt deployment performs no remote build, and it
stalls identically. The fault is in deployment acceptance, not compilation, and
sits above the project — most likely an account-level limit, a hold on the
account, or a platform incident.

### What to do

1. Open <https://vercel.com/aionixdev/slate-control-center> and read the status
   of any deployment newer than `pa0vyded8`. The dashboard shows a reason the
   CLI does not surface.
2. Check the account for a billing hold, a spend cap, or an exhausted
   concurrent-build allowance: <https://vercel.com/account/billing> and the
   team's usage page.
3. Check <https://www.vercel-status.com> for an incident overlapping
   2026-08-15 01:00–02:00 UTC-3.
4. If none of these explain it, contact Vercel support with deployment id
   `dpl_96RDqKidmsE2fSK1ygzJmbbPSf2Q`, which was created and never built.

### How to validate

```
vercel deploy --prod --yes --scope aionixdev
```
Expected: reaches `● Ready` and the alias serves the new build.

### What has already been completed

The project exists and is correctly configured: root directory
`apps/control-center`, framework `nextjs`, GitHub connected, and `DATABASE_URL`
set for both Production and Preview. A verified-good Dockerfile also exists, so
the application can be hosted anywhere container-based if Vercel stays blocked.

### What happens after

Cloud hosting becomes available again for the PWA milestone. The Control Center
does not need it and will continue running locally.

---

## ACTION-002 — Windows code-signing certificate for the Desktop Agent installer

**STATUS:** OPEN
**PROJECT BLOCKED:** NO
**BLOCKS:** Trusted installer distribution only. The Agent builds, installs, and
runs; Windows SmartScreen will warn on first run until signed.

### Why

Mandate §8 requires a real Windows installer. Authenticode signing requires a
certificate (OV or EV) purchased from a certificate authority. This is a
commercial purchase requiring company identity verification for Aionixdev — it
cannot be performed autonomously.

### What to do

1. Purchase an OV or EV code-signing certificate (e.g. DigiCert, Sectigo,
   SSL.com) under the Aionixdev legal entity. EV gives immediate SmartScreen
   reputation; OV builds reputation over time.
2. Complete the CA's organisation validation.
3. Store the certificate and password as GitHub repository secrets:
   `WINDOWS_CERT_BASE64`, `WINDOWS_CERT_PASSWORD`.

### How to validate

A produced installer shows a verified Aionixdev publisher in its properties, and
`signtool verify /pa slate-setup.exe` succeeds.

### What has already been completed

The full build and packaging pipeline is authored so signing is a single
configuration step; the release build produces an unsigned installer meanwhile.

### What happens after

Released installers are trusted, SmartScreen warnings disappear, and auto-update
can verify signatures.

---
