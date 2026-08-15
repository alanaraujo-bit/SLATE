# SLATE — Blockers

A **blocker** is something preventing work that would otherwise be executable.
Distinguished per mandate §28:

- **FEATURE BLOCKER** — halts one feature; every other front continues.
- **PROJECT BLOCKER** — halts all executable work. Requires immediate escalation.

Operator-dependent items live in
[OPERATOR_ACTIONS.md](./OPERATOR_ACTIONS.md); this file tracks technical
blockers discovered during execution.

---

## Active

### BLOCKER-001 — GitHub Actions workflows cannot be committed

- **Type:** FEATURE BLOCKER
- **Blocks:** CI/CD automation
- **Does not block:** application code, cloud deploys, cloud validation, testing
- **Cause:** `gh` token lacks the `workflow` scope
- **Owner:** operator — see [ACTION-001](./OPERATOR_ACTIONS.md#action-001--grant-workflow-scope-to-the-github-cli-token)
- **Mitigation in place:** workflow definitions are authored and version-controlled
  under `docs/deployment/ci/`, then relocated to `.github/workflows/` once the
  scope is granted. No work is lost or deferred, only its activation.

---

## Resolved

_None yet._
