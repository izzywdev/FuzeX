# design-frames-service

FuzeX's product for the **authoring, lifecycle, and review** of navigable HTML design
frames — per-flow approval/reject and a navigable review site — consumable over
**REST**, **MCP**, and **A2A**. It imports legacy FuzeFront GitHub Pages artifacts
(see [`docs/EXTRACTION.md`](./docs/EXTRACTION.md)) but is the system of record once
they are adopted.

## Frames are data, owned by FuzeX after adoption

The importer accepts a local checkout of an old static frame set because it retains
the original manifest, flow mapping and source-content hash without fetching arbitrary
URLs. That source is immutable provenance only. After adoption, FuzeX owns the frame
artifact, revisions, review decisions, annotations, and future authoring; GitHub Pages
and Git are no longer a design authoring or source-of-truth path.

## Import existing GitHub Pages frame sets

Import from the **repository source** that generated Pages, not from a scraped
deployment. This retains manifests, flow mappings, and provenance without
turning the service into an arbitrary URL fetcher. Check out the desired
revision, then run:

```bash
DESIGN_FRAMES_SERVICE_URL=https://fuzex.example.com \
DESIGN_FRAMES_API_TOKEN=… \
node client/design-frames-client.mjs import-all /path/to/FuzeFront/design/frames \
  izzywdev/FuzeFront
```

The importer reads the original repository files into one source snapshot,
embeds linked local CSS, and submits the entire manifest and frame set in one
atomic import. It removes files absent from a later source set. Concurrent
publishers use compare-and-swap: a changed base returns 409 rather than
silently overwriting another import. Each unique hosted content stamp is retained
as an immutable revision, so later imports cannot rewrite reviewed frames.

Provenance distinguishes `manifest.sourceStamp` (FuzeFront's original source-tree
hash before CSS embedding) from `manifest.stamp` (the hosted artifact hash).
`sourceRepo` and `importerVersion` are recorded in both the manifest and revision
metadata. A source stamp includes every original file, including CSS, using the
same canonical manifest and path ordering as `scripts/stamp-frames.mjs`.

Hosted approve/reject requests always record a content stamp. Clients should
send the stamp displayed during review; stale reviews return 409. Legacy callers
that omit the stamp bind to current content under the same write guard.
Changing content leaves earlier decisions in history and clears their approval
projection for the new revision.

Publication uses immutable directories and an atomically replaced current
pointer. Per-feature filesystem locks also serialize independent service
processes sharing the same volume. A lock timeout returns 409; an interrupted
writer's lock requires an operator to verify that no writer is active before
removing it. Working generations are retained for in-flight readers; storage
retention must preserve immutable revisions and coordinate any working-generation
cleanup with readers.

## What it replaces

FuzeFront's original pipeline authored frames as files directly in its own repo
(`design/frames/<feature>/`), stamped them with a content hash
(`scripts/stamp-frames.mjs`), approved flows via a GitHub Issue + a deploy-key push to
`master` (`design-approval.yml`), and published a static site to GitHub Pages
(`pages-frames.yml`). Frame **authorship stays exactly there** — this service
reimplements the *lifecycle* concepts on top of it — content stamping, per-flow
approval, a navigable review site — as a real backend with a REST API, so approval
state (and the review UI) live in one shared place instead of being reinvented per
repo.

The importer is a one-time adoption path for those legacy static frame sets. It keeps
their source repository and source-content stamp as immutable provenance, but the
imported artifact, subsequent revisions, reviews, annotations, and Design System
decisions are owned by FuzeX. Repository URLs are normalized to the canonical
`owner/repository` form so an import joins an explicitly database-managed App connection;
the importer never creates an App from a manifest.

## Run it

```bash
cd services/design-frames-service
npm test                 # runs the full suite (stamp/schema/store/server)
FUZEFRONT_API_URL=https://app.fuzefront.com npm run dev    # http://localhost:4400
```

Open `http://localhost:4400/` for the frontend (feature list → frame viewer →
per-flow approve/revoke). Writes need a FuzeFront-issued **machine token**
carrying the `fuzex:frames:write` scope — paste one into the "API token" field
to unlock write actions. Reads (feature list, manifest, frame content, the
`/site/**` review surface) are intentionally public — see the security note in
`server.js`.

Obtain a machine token from FuzeFront's `POST /api/v1/security/tokens`
(client-credentials); `createServiceAuthClient` in
`@izzywdev/fuzefront-service-auth` will fetch, cache and refresh one for you.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `DESIGN_FRAMES_HOST` | `0.0.0.0` | bind address — unlike `bridge-server.js` this service is meant to be network-reachable |
| `DESIGN_FRAMES_PORT` | `4400` | listen port |
| `DESIGN_FRAMES_DATA_DIR` | `./data/features` | file-backed storage root (one dir per feature, mirrors FuzeFront's `design/frames/<feature>/` layout) |
| `FUZEFRONT_API_URL` | *(unset)* | FuzeFront's **origin** (NOT ending in `/api`), used to verify machine tokens at `/api/v1/security/tokens/introspect`. **Unset = every write is rejected.** |
| `DESIGN_FRAMES_REQUIRED_SCOPE` | `fuzex:frames:write` | scope a machine token must carry to write |
| `DESIGN_FRAMES_INTROSPECTION_CACHE_SECONDS` | `5` | how long a POSITIVE introspection result is reused. Negative results are never cached, so a revocation takes effect on the next request. |

> Replaced `DESIGN_FRAMES_API_TOKENS` (issue #26). That variable was a
> comma-separated pre-shared bearer list whose **unset** state made every write
> *unauthenticated*, not rejected — the opposite of what its docs said. Nothing
> below has an open-by-default mode.

## REST API

See [`openapi.yaml`](./openapi.yaml) for the full contract. Summary:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
| GET | `/api/v1/features` | none | list features + flow approval summary |
| POST | `/api/v1/features` | token | create a feature shell |
| GET | `/api/v1/features/:slug` | none | manifest + all frame contents |
| POST | `/api/v1/features/:slug/import` | token | atomically replace the entire manifest/frame set; optional `expectedStamp` CAS |
| PUT | `/api/v1/features/:slug/manifest` | token | replace the manifest (schema-validated) |
| GET | `/api/v1/features/:slug/stamp` | none | compute the current content stamp, compare to the persisted one |
| POST | `/api/v1/features/:slug/stamp` | token | compute AND persist the stamp (binds future approvals to current content) |
| GET | `/api/v1/features/:slug/revisions` | none | list immutable content revisions |
| GET | `/api/v1/features/:slug/revisions/:stamp` | none | retrieve one revision's manifest and frame bytes |
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
