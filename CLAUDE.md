# FuzeX — CLAUDE.md (L1 overlay)

This repo **extends** the FuzeSDLC baseline (L0, `izzywdev/FuzeSDLC` `CLAUDE.baseline.md`, pinned at `baselineRef: main` in `.fuze/manifest.json`). The baseline governs unless this overlay states otherwise; where they conflict, this repo wins.

## Repo identity
- **Class:** `oss-public` — public, **MIT-licensed**, open contribution / public security disclosure. Do not ship any non-permissive license here; do not change the MIT LICENSE.
- **Tier:** `product`.
- **Expert:** **`fuzex-expert`** — consult it first on any FuzeX task to load architecture/run/gotcha context (it advises, it doesn't gate or own deliverables). Verify against the actual files.

## What FuzeX is (one line)
A **SaaS product for UX/UI management** with two surfaces: a **served product** (`services/design-frames-service` — REST + MCP + A2A backend, its own same-origin frontend, and a Module-Federation remote the FuzeFront portal mounts) and an **AI-driven Figma plugin + MCP/SSE bridge** (vanilla JS/HTML on Node: in-Figma plugin `code.js`/`ui.html` ⇄ standalone `bridge-server.js` ⇄ external MCP clients). See `fuzex-expert` for the full map.

> **Corrected 2026-08-19.** This line used to read "An AI-driven Figma plugin + MCP/SSE bridge … no build step", full stop — and `.fuze/manifest.json` said FuzeX had no served origin, no `remoteEntry`, and did not register with the portal. That was accurate when FuzeX was a static, local frame-approval tool. It has since scaled up into a full product: it deploys (`deploy/helm/fuzex`, `deploy/argocd/application.yaml`), it **registers itself** from a fail-closed init container using this repo's own `registration/{manifest,policy}.json`, and it does have a build step (`services/design-frames-service/webapp`). The plugin is now one surface of FuzeX, not the whole of it.

## Portal onboarding (this repo owns it)
FuzeX is registered with the FuzeFront app registry under slug **`fuzex`**, by **this repo**, not by an orchestrator:
- `registration/manifest.json` + `registration/policy.json` — the payload. Mirrored into `deploy/helm/fuzex/files/registration/`; `scripts/check-registration.mjs` fails CI if the copies drift.
- **Slug `fuzex`, display name `X` — and that split is deliberate.** What the owner does not want is a portal nav listing fifteen entries that all begin "Fuze", so the thing that de-prefixes is the **display name** (`name` / `menuLabel` in `registration/manifest.json`), not the slug. The slug keeps the prefix, and for FuzeX it *must*: the contract's `Slug` pattern `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` requires **3+ characters**, so `fuzex` → `x` is rejected by the platform with a 400, `register.sh` treats a 400 as fatal, and the pod CrashLoopBackOffs — the exact failure the fail-closed init container exists to surface. `@fuzefront/onboarding-kit`'s `validateSlugConvention()` carries the short-name exemption and passes `fuzex` verbatim.
  **Do not "correct" the slug.** It is immutable once registered, and a `/^fuze/i` slug rejection exists in only four sibling repos (fuzedeploy, fuzecall, fuzeexecutive, fuzefinance); it is **not** in FuzeSDLC's canonical `check-registration.mjs`. That is local drift, not policy.
- `deploy/helm/fuzex/templates/deployment.yaml` — the **fail-closed** `fuzefront-register` init container. It reads a Bearer token from Secret `<namespace>/fuzefront-registration`, key `token`. The init container is **unconditional** — there is deliberately no `registration.enabled` value, because a fail-closed step behind a switch is only fail-closed until someone flips the switch. If registration fails the pod **must** CrashLoopBackOff: never add `|| true`, `continue-on-error`, a values guard, or any other skip condition. A pod that comes up unregistered is invisible to the portal, which is the bug this exists to prevent.
- `deploy/argocd/application.yaml` — one Argo CD Application, `prune: false` (the store is a PVC of approvals).
- The remote's shared `react`/`react-dom` `requiredVersion` is **`^19.0.0`**, identical to the FuzeFront host's. A different range loads a second React copy and dies on "Invalid hook call" in the browser, with nothing in CI to catch it — never "fix" it to something that merely works locally.

## Agents & routing
The canonical single-responsibility agents live in `.claude/agents/`; the instantiated subset is declared in `.fuze/manifest.json`. Routing, the done-contract (`SCOPE DONE (verified)` + `OUT OF SCOPE — NOT DONE`), contract-first fan-out, and the verification protocol all follow the L0 baseline — this overlay does not restate them.

## Hardening (unchanged here)
Ruleset, the six `gate-*` checks, signed commits, the automation stack, and nightly reconciliation are already applied and are **identical across classes**. They are owned by `devops-engineer` / `security` / `platform-governance` — this overlay only adds agent governance and does not modify hardening or the LICENSE. Infra changes are delegated to FuzeInfra via `@claude`, never made from this repo.
