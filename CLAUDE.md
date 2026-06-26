# FuzeX — CLAUDE.md (L1 overlay)

This repo **extends** the FuzeSDLC baseline (L0, `izzywdev/FuzeSDLC` `CLAUDE.baseline.md`, pinned at `baselineRef: main` in `.fuze/manifest.json`). The baseline governs unless this overlay states otherwise; where they conflict, this repo wins.

## Repo identity
- **Class:** `oss-public` — public, **MIT-licensed**, open contribution / public security disclosure. Do not ship any non-permissive license here; do not change the MIT LICENSE.
- **Tier:** `product`.
- **Expert:** **`fuzex-expert`** — consult it first on any FuzeX task to load architecture/run/gotcha context (it advises, it doesn't gate or own deliverables). Verify against the actual files.

## What FuzeX is (one line)
An AI-driven Figma plugin + MCP/SSE bridge (vanilla JavaScript/HTML on Node, no build step): in-Figma plugin (`code.js`/`ui.html`) ⇄ standalone `bridge-server.js` ⇄ external MCP clients. See `fuzex-expert` for the full map.

## Agents & routing
The canonical single-responsibility agents live in `.claude/agents/`; the instantiated subset is declared in `.fuze/manifest.json`. Routing, the done-contract (`SCOPE DONE (verified)` + `OUT OF SCOPE — NOT DONE`), contract-first fan-out, and the verification protocol all follow the L0 baseline — this overlay does not restate them.

## Hardening (unchanged here)
Ruleset, the six `gate-*` checks, signed commits, the automation stack, and nightly reconciliation are already applied and are **identical across classes**. They are owned by `devops-engineer` / `security` / `platform-governance` — this overlay only adds agent governance and does not modify hardening or the LICENSE. Infra changes are delegated to FuzeInfra via `@claude`, never made from this repo.
