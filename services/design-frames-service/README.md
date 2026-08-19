# design-frames-service

FuzeX's product for the **lifecycle** of navigable HTML design frames — per-flow
approval/reject and a navigable review site — consumable over **REST**, **MCP**, and
**A2A**. Modeled on FuzeFront's `design/frames/**` pipeline (see
[`docs/EXTRACTION.md`](./docs/EXTRACTION.md)), reimplemented here as a real, shared
backend so any product can drive design review against it — but the frames themselves
are **not authored or stored here as this repo's own files**. See
[`skills/design-frames-lifecycle/SKILL.md`](./skills/design-frames-lifecycle/SKILL.md)
for the full story; the short version is next.

## Frames are data, not this repo's content

Treat a feature's navigable HTML frames the way you'd treat a `.fig` file: it's
authored and version-controlled in the product repo that owns the feature —
`design/frames/<feature>/` in FuzeFront, or wherever the equivalent lives in another
product's repo — never inside `izzywdev/FuzeX` itself. This service ingests that
content (via its client package, `client/design-frames-client.mjs`, or directly over
the REST/MCP API) and becomes the system of record for its **lifecycle** — per-flow
approval/reject bound to a content stamp, and a navigable review site — the same way a
design tool becomes the system of record for a file's review state without becoming
the only place that file exists. Content is re-synced from the owning repo whenever it
changes; approval/reject state and the review site live here.

## What it replaces (and what it doesn't — yet)

FuzeFront's original pipeline authored frames as files directly in its own repo
(`design/frames/<feature>/`), stamped them with a content hash
(`scripts/stamp-frames.mjs`), approved flows via a GitHub Issue + a deploy-key push to
`master` (`design-approval.yml`), and published a static site to GitHub Pages
(`pages-frames.yml`). Frame **authorship stays exactly there** — this service
reimplements the *lifecycle* concepts on top of it — content stamping, per-flow
approval, a navigable review site — as a real backend with a REST API, so approval
state (and the review UI) live in one shared place instead of being reinvented per
repo.

**FuzeFront's 14 existing `design/frames/<feature>/` directories, and every new one it
creates, stay in FuzeFront's own repo** — nothing migrates. Any product — FuzeFront or
otherwise — installs the [`design-frames-lifecycle`](./skills/design-frames-lifecycle/SKILL.md)
skill and its client package to sync locally-authored frames here for approval/reject
tracking and navigability.

## Run it

```bash
cd services/design-frames-service
npm test                 # runs the full suite (stamp/schema/store/server)
DESIGN_FRAMES_API_TOKENS=dev-token npm run dev    # http://localhost:4400
```

Open `http://localhost:4400/` for the frontend (feature list → frame viewer →
per-flow approve/revoke). Paste the token into the "API token" field to
unlock write actions; reads (feature list, manifest, frame content, the
`/site/**` review surface) are intentionally public — see the security note
in `server.js`.

## Portal onboarding — FuzeX registers itself

FuzeX is a product in the FuzeFront family and is onboarded like every other one. This
service is the served surface that carries it.

- **The payload.** `registration/manifest.json` and `registration/policy.json` at the repo
  root; `deploy/helm/fuzex/files/registration/` is the vendored copy Helm renders into a
  ConfigMap. `scripts/check-registration.mjs` fails CI if the policy copies drift, and
  `scripts/sync-chart-files.sh --check` covers the rest.
- **Slug `fuzex`, display name `X`.** The prefix comes off the **display name**, not the
  slug — the portal nav should not read as fifteen entries all starting "Fuze", so
  `registration/manifest.json` carries `"slug": "fuzex"` with `"name": "X"` /
  `"menuLabel": "X"`. For FuzeX the slug *must* keep the prefix: the contract's `Slug`
  pattern is `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` — a **minimum of three characters** — so
  `x` is rejected with a 400, `register.sh` treats a 400 as fatal, and the pod
  CrashLoopBackOffs. `@fuzefront/onboarding-kit`'s `validateSlugConvention()` carries the
  short-name exemption and passes `fuzex` verbatim. `slug` is **immutable once registered**;
  do not "de-prefix" it. See [`registration/README.md`](../../registration/README.md).
- **Registration is fail-closed.** `deploy/helm/fuzex/templates/deployment.yaml` runs the
  `fuzefront-register` init container unconditionally. It reads a Bearer token from Secret
  `<namespace>/fuzefront-registration`, key `token`. If registration fails, the pod
  CrashLoopBackOffs — on purpose. **Never** add `|| true`, `continue-on-error`, or a skip
  condition: a pod that comes up unregistered is up, serving, and invisible to the portal.
- **Same-origin, always.** The landing page, the remote bundle and the API are one origin
  and one process. The frontend's API base is the empty string
  (`frontend/app.js`, `webapp/src/api.ts`); hard-coding an absolute API host breaks under
  local TLS (mixed content) and under the prod ingress (CORS).
- **Module-Federation contract.** Scope `fuzex`, module `./DesignFramesApp`, remoteEntry
  `/apps/fuzex/remoteEntry.js`, `react`/`react-dom` shared as singletons at
  `requiredVersion: ^19.0.0` — **identical** to the FuzeFront host's. A different range
  loads a second React copy and dies on "Invalid hook call" in the browser, with nothing
  in CI to catch it.
- **The bundle ships in the image.** The Dockerfile builds `webapp/` in a `node:24-alpine`
  builder stage and copies `dist/` to `/app/webapp-dist`; `server.js` serves it at
  `/apps/fuzex/`. The design system `@izzywdev/fuzefront-design-system` is a **private**
  GitHub Packages package, so that install reads a `read:packages` token from a BuildKit
  **secret mount** — never a build ARG, never a layer. The grant is in place today (CI's
  `docker-build` resolves the package and its smoke step fetches a real
  `/apps/fuzex/remoteEntry.js`); if it is ever revoked the symptom is a 401 in the builder
  stage — a package-settings problem, not a code bug.

> **Corrected 2026-08-19.** Earlier docs in this repo (`.fuze/manifest.json`,
> `docs/EXTRACTION.md`, `skills/design-frames-lifecycle/SKILL.md`, the root `README.md`)
> said FuzeX had no served origin, no `remoteEntry`, could not register, and that its
> portal presence was arranged by an orchestrator. That described the static, local
> frame-approval tool FuzeX began as. It no longer describes FuzeX, and those notes have
> been rewritten in place rather than deleted so the change reads as an evolution.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `DESIGN_FRAMES_HOST` | `0.0.0.0` | bind address — unlike `bridge-server.js` this service is meant to be network-reachable |
| `DESIGN_FRAMES_PORT` | `4400` | listen port |
| `DESIGN_FRAMES_DATA_DIR` | `./data/features` | file-backed storage root (one dir per feature, mirrors FuzeFront's `design/frames/<feature>/` layout) |
| `DESIGN_FRAMES_API_TOKENS` | *(unset)* | comma-separated bearer tokens accepted for write operations. **Unset = writes are unauthenticated — do not deploy without setting this.** |
| `DESIGN_FRAMES_WEBAPP_DIR` | `./webapp-dist` | the built Module-Federation remote, served at `/apps/fuzex/`. The image bakes it at `/app/webapp-dist`; override only for a local `npm run build` in `webapp/` |

## REST API

See [`openapi.yaml`](./openapi.yaml) for the full contract. Summary:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness — answered **before any auth**, as the platform requires |
| GET | `/openapi` | none | this contract, as YAML. `/openapi.yaml` and `/openapi.json` are aliases returning identical bytes |
| GET | `/apps/fuzex/:file` | none | the Module-Federation remote bundle (`remoteEntry.js` + chunks), same origin as this API |
| GET | `/api/v1/features` | none | list features + flow approval summary |
| POST | `/api/v1/features` | token | create a feature shell |
| GET | `/api/v1/features/:slug` | none | manifest + all frame contents |
| PUT | `/api/v1/features/:slug/manifest` | token | replace the manifest (schema-validated) |
| GET | `/api/v1/features/:slug/stamp` | none | compute the current content stamp, compare to the persisted one |
| POST | `/api/v1/features/:slug/stamp` | token | compute AND persist the stamp (binds future approvals to current content) |
| GET/PUT/DELETE | `/api/v1/features/:slug/frames/:file` | none / token / token | one frame's HTML |
| POST | `/api/v1/features/:slug/flows/:flowId/approve` | token | approve a flow — `{ "approvedBy": "..." }` |
| POST | `/api/v1/features/:slug/flows/:flowId/reject` | token | revoke approval |
| GET | `/site/:slug` , `/site/:slug/:file` | none | rendered navigable review site (replaces GitHub Pages) |

## MCP

`mcp/server.js` + `mcp/tools.json` expose the same operations as MCP tools
(`list_features`, `get_feature`, `propose_frame`, `compute_stamp`,
`approve_flow`, …) over stdio, for use from an MCP-capable client or agent.

## A2A

`agent-templates/roles/design-review/role.json` (repo root) declares the
`design-review` role this service serves — see `.fuze/manifest.json`'s `a2a`
block.

## Data model

One directory per feature under `DESIGN_FRAMES_DATA_DIR`:

```
data/features/<slug>/
  manifest.json     # see lib/manifest.schema.json
  frames/
    01-*.html
    02-*.html
    ...
```

No database — deliberately, matching this repo's dependency-light,
no-build-step convention (see `bridge-server.js`). If a consuming product
needs to query design-frames data relationally at scale, that's a reason to
add a real datastore later, not a reason to build one preemptively here.
