# design-frames-service

Standalone product-design-phase service: navigable HTML frames, a per-flow
approval workflow, and the API/component/flag contract seam — consumable over
**REST**, **MCP**, and **A2A**. Extracted from FuzeFront's `design/frames/**`
pipeline (see [`docs/EXTRACTION.md`](./docs/EXTRACTION.md)) into its own
repo/product so any consumer, not just FuzeFront, can drive design review
against it.

## What it replaces (and what it doesn't — yet)

FuzeFront's original pipeline authored frames as files directly in its own
repo (`design/frames/<feature>/`), stamped them with a content hash
(`scripts/stamp-frames.mjs`), approved flows via a GitHub Issue + a deploy-key
push to `master` (`design-approval.yml`), and published a static site to
GitHub Pages (`pages-frames.yml`). This service reimplements the same
*concepts* — content stamping, per-flow approval, a navigable review site —
as a real backend with a REST API, so approval state lives in one place
instead of being written back into whichever repo asked for it.

**FuzeFront's 14 existing `design/frames/<feature>/` directories are
untouched** — this is a plumbing-only extraction (see the FuzeFront-side PR).
New features going forward are authored here.

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

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `DESIGN_FRAMES_HOST` | `0.0.0.0` | bind address — unlike `bridge-server.js` this service is meant to be network-reachable |
| `DESIGN_FRAMES_PORT` | `4400` | listen port |
| `DESIGN_FRAMES_DATA_DIR` | `./data/features` | file-backed storage root (one dir per feature, mirrors FuzeFront's `design/frames/<feature>/` layout) |
| `DESIGN_FRAMES_API_TOKENS` | *(unset)* | comma-separated bearer tokens accepted for write operations. **Unset = writes are unauthenticated — do not deploy without setting this.** |

## REST API

See [`openapi.yaml`](./openapi.yaml) for the full contract. Summary:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
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
