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
