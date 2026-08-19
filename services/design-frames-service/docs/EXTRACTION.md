# Extraction record: FuzeFront's navigable-frames pipeline → FuzeX

**Date:** 2026-08-10. **Corrected:** 2026-08-11 (*Correction*) and 2026-08-19
(*Correction 2*) — see both below. This record's original "Why"/"What's different"
sections described the wrong split, and its "explicitly deferred" list described a FuzeX
that no longer exists; both are kept here struck through for history, with the corrected
model following.

**Origin PR (FuzeFront):** see `docs/planning/design-first-ui-pipeline.md` in
that repo for the pipeline this was ported from.

## Correction (2026-08-11): frames stay in the owning repo; FuzeX owns lifecycle, not storage

The first pass of this extraction (below) read as "new features author their frames in
FuzeX instead of their own repo." That's wrong, and got corrected before it shipped
broadly: **frames are data, like a `.fig` file** — authored and version-controlled in
whichever product repo owns the feature (FuzeFront's `design/frames/<feature>/` for
FuzeFront features, and the equivalent in any other consuming repo), the same way they
always were. FuzeX/design-frames-service is the **product that manages their lifecycle**
— per-flow approval/reject and a navigable review site — not their storage location or
their authoring tool. A consuming repo keeps authoring frames locally exactly as before,
then installs the [`design-frames-lifecycle`](../skills/design-frames-lifecycle/SKILL.md)
skill + its client package (`../client/design-frames-client.mjs`) to sync that content
here. See the service's [README.md](../README.md) for the corrected framing in full.

This reverses FuzeFront's `gate-frames-external` (which blocked new local
`design/frames/<feature>/` directories) — that gate is being removed on the FuzeFront
side as part of this correction; new features go back to being authored locally there,
same as the 14 that were never touched.

## Why (original — see Correction above for what actually applies)

FuzeFront's "design-first" gate (its `CLAUDE.md` §"Design-first gate") built
navigable HTML frames as the authoritative pre-implementation design
artifact: `design/frames/<feature>/index.html` + numbered screens +
`manifest.json`, content-stamped, approved per-flow via a GitHub Issue, and
published to GitHub Pages. It worked, but it was implemented as files +
scripts + CI glue *inside FuzeFront's own repo* — closer to what a standalone
design-tool product looks like than a feature of a Module-Federation host
shell. FuzeX — an AI-driven design/Figma-adjacent tool — is a more natural
home for **the lifecycle machinery** (approval/reject + navigable review) than
FuzeFront's own repo, and hosting *that* there lets it be shared by more than
one product — the frame files themselves were never meant to relocate.

## What was ported vs. reimplemented

Nothing was copied byte-for-byte; FuzeFront's originals stayed in FuzeFront
(the 14 existing `design/frames/<feature>/` dirs are untouched — see the
FuzeFront-side PR). This service reimplements the same mechanisms:

| FuzeFront original | This service | Notes |
|---|---|---|
| `scripts/stamp-frames.mjs` (sha256 over feature dir, approval keys excluded) | `lib/stamp.js` | Same algorithm, works over in-memory manifest+frames instead of a directory walk. |
| `design/frames/_template/manifest.schema.json` | `lib/manifest.schema.json` + `lib/schema.js` | Same shape, `frames[]` allowed empty (incremental authorship via the API, vs. FuzeFront's whole-feature-at-once file authorship). |
| `design-approval.yml` (GitHub Issue → deploy-key push to `master`) | `POST /api/v1/features/:slug/flows/:flowId/approve` | Real API + persisted state instead of a GitHub Issue parse + git push. |
| `pages-frames.yml` / `build-frames-site.mjs` (GitHub Pages static site) | `GET /site/:slug`, `GET /site/:slug/:file` | Server-rendered instead of statically built/published. |
| `gate-ds-conformance` | *(not ported)* | FuzeFront-specific (scans `frontend/`, `packages/*ui*` for raw hex/px). Out of scope for a design-tool service that doesn't own any product's frontend source. |
| `gate-frames-first`, `gate-frames-schema` | *(not ported — they didn't exist)* | FuzeFront's CLAUDE.md and planning doc describe these as live; verified against the actual repo, they were never implemented. Not carried over as fictitious gates. |

## What's intentionally different

- **Ingestion over an API, not authorship.** A feature starts as a shell
  (`POST /features`) and frames are pushed one at a time (`PUT .../frames/:file`) by
  the owning repo's sync step (see the `design-frames-lifecycle` skill) — this service
  never originates frame content. FuzeFront's original wrote frames to disk and
  committed them as a single PR; that step is unchanged and still happens in
  FuzeFront's own repo. What's incremental here is the *publish* of already-authored
  content, not the authoring itself.
- **File-backed storage, not a database** — matches this repo's
  dependency-light convention (see `bridge-server.js`'s single `uuid`
  dependency). Directory-per-feature layout deliberately mirrors FuzeFront's
  `design/frames/<feature>/` so a feature can be exported/imported 1:1 later.
- **Network-reachable by design.** `bridge-server.js` is a localhost-only dev
  bridge; this service is meant to be deployed and called by other products'
  CI, so it binds `0.0.0.0` and authenticates writes with a bearer token
  (`DESIGN_FRAMES_API_TOKENS`) instead of relying on a loopback bind.

## What's explicitly deferred (not done in this extraction)

- **FuzeFront's 14 existing features (and every feature after them) are not
  migrated, and never will be — see the Correction above.** They stay authored in
  FuzeFront's repo permanently; syncing them here (optional, via
  `design-frames-lifecycle`) is additive, not a move.
- ~~**No Module-Federation embed.**~~ **SUPERSEDED (2026-08-19) — see
  *Correction 2* below.** This bullet said FuzeFront consumed the service over its
  REST API only, that the frontend here was not mounted inside the FuzeFront shell,
  and that FuzeX had zero frontend build tooling and a `portal.registers: false` in
  `.fuze/manifest.json`. None of that is true any more.
- **No Authentik/Permit integration.** Auth is a static bearer token for now.
  Family-standard auth would mean wiring this service onto FuzeInfra, which
  is out of scope for a same-session change (FuzeInfra changes are delegated
  via `@claude`, never made directly — see this repo's `CLAUDE.md`).
- **No persisted datastore beyond the filesystem.** See README.md's Data
  model section for the reasoning.


## Correction 2 (2026-08-19): FuzeX is a served product, and it registers itself

The deferral above, and the `.fuze/manifest.json` note it cited, both described FuzeX
as a **local, static frame-approval tool wrapped in a Figma plugin**: UI in Figma's
plugin sandbox, `networkAccess` pinned to localhost, therefore no served origin to
iframe, no `remoteEntry` to federate, and no registration of its own — whatever portal
presence it had was said to be arranged for it by an orchestrator.

That was an accurate description of FuzeX **when it was written**. It is not a
description of FuzeX now, and the old text is struck through rather than deleted so the
next reader sees an evolution instead of a contradiction. FuzeX has scaled up into a
**full SaaS product for UX/UI management**, and it is onboarded like every other product
in the family:

| Then | Now |
|---|---|
| No served origin | `services/design-frames-service` serves the API, its own landing page, and the remote bundle on one real origin |
| No health/contract endpoints on a served origin | `GET /health` and `GET /openapi` (aliases `/openapi.yaml`, `/openapi.json`), both answered **before** any auth |
| No `remoteEntry` to federate | Module-Federation remote `services/design-frames-service/webapp` — scope `fuzex`, module `./DesignFramesApp`, served same-origin at `/apps/fuzex/remoteEntry.js`, `react`/`react-dom` shared as singletons at `requiredVersion: ^19.0.0` (identical to the host's; a different range silently loads a second React and dies on "Invalid hook call" in the browser) |
| `portal.registers: false` | `portal.registers: true`, with a **fail-closed** registration init container on the pod (`deploy/helm/fuzex/templates/deployment.yaml`) |
| "registration handled by the orchestrator" | `registration/manifest.json` + `registration/policy.json` (slug `fuzex`, display name `X`) live **in this repo**, are rendered into a ConfigMap by **this** chart, and are pushed by **this** pod |
| No deployment path | `deploy/helm/fuzex` (chart) + `deploy/argocd/application.yaml` (Argo CD Application) |

The Figma/FigJam plugin at the repo root (`manifest.json`, `code.js`, `ui.html`) has not
gone anywhere and is still sandboxed with localhost-only network access. It is now **one
surface of the product rather than the whole of it** — which is exactly why the old note
read as a statement about FuzeX-the-repo when it was only ever true of FuzeX-the-plugin.

One dependency worth writing down, because its failure mode does not look like itself: the
remote's design system (`@izzywdev/fuzefront-design-system`) is a **private** GitHub Packages
package. The image builds the bundle in a `node:24-alpine` builder stage using a BuildKit
**secret mount** for a `read:packages` token, so the token never reaches a layer — but the
build depends on that package granting `izzywdev/FuzeX` Actions read access. It does today
(CI's `docker-build` resolves it and serves a real `/apps/fuzex/remoteEntry.js`). If the grant
is revoked, the builder stage 401s and the whole image build fails — a package-settings
problem presenting as a broken Dockerfile.
