# design-frames-service — Postgres lifecycle tier (backend)

The isolated Express + `pg` + TypeScript tier described in
[`../docs/postgres-tier.md`](../docs/postgres-tier.md) and backing
[`../openapi.yaml`](../openapi.yaml) v0.2.0. **Separate from `../server.js`**
(the vanilla flat-file service) — additive, runnable alongside it, never a
rewrite of it. Frame CONTENT (manifest.json + frame `*.html`) still lives in
the file tier (`../lib/store.js`, reused here via `src/lib/fileStore.ts`);
this tier adds the Postgres-backed lifecycle/index surface (projects,
append-only approvals, discussions) and dual-writes the flat-file projection
so nothing that reads files directly breaks during rollout.

## What this is NOT

- Not a replacement for `../server.js` — that file is untouched.
- Not where DB provisioning happens — FuzeInfra provisions the database, the
  `design_frames` schema's owning role, and the `DATABASE_URL` SealedSecret
  (see `../db/README.md`). This tier only *connects*.
- Not a duplicate migration runner — `../db/migrate.sh` already exists and
  is referenced, not reimplemented.

## Run

```bash
cp .env.example .env   # then edit DATABASE_URL to point at a migrated Postgres
npm install
npm run build
npm start                 # listens on DESIGN_FRAMES_PG_PORT (default 4410)
```

`DESIGN_FRAMES_PG_PORT` defaults to **4410**, deliberately different from
`../server.js`'s `DESIGN_FRAMES_PORT` (4400), so both can run side by side.

## Backfill (docs/postgres-tier.md migration step 4)

Seeds `project`/`feature`/`flow`/`frame_ref` rows + one `approval` row per
already-approved flow for every feature that exists on disk before this tier
existed. Idempotent — safe to re-run.

```bash
npm run backfill
```

## Test

```bash
npm test
```

Runs the pure-logic unit tests (pagination clamp/cursor walk, manifest
projection, auth) unconditionally, and the full HTTP integration suite
(`tests/integration.test.cjs`) against a **real** Postgres pointed to by
`DATABASE_URL` — apply `../db/migrate.sh` first. If `DATABASE_URL` is unset,
the integration suite self-skips (with a warning) rather than failing, but
also does not verify anything — see the implementation PR body for exactly
what was and was not runtime-verified in this session.

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/scratch_db ../db/migrate.sh
DATABASE_URL=postgres://user:pass@localhost:5432/scratch_db npm test
```

## Layout

```
src/
  app.ts              — Express app assembly (CORS, auth, routers, error handler)
  index.ts            — process bootstrap (listen, graceful shutdown)
  lib/
    logger.ts          — shared pino logger, reqId child-logger, boundary timer
    db.ts              — pg Pool + query()/withTransaction() boundary wrapper
    errors.ts          — typed errors + the error-handling middleware
    pagination.ts       — the {items, page:{nextCursor,hasMore,total?}} envelope
    identity.ts         — re-exports @fuzex/identity (../../../packages/identity)
    fileStore.ts        — typed wrapper around ../lib/store.js (content tier, reused)
    stampLib.ts          — typed wrapper around ../lib/stamp.js (computeStamp, reused)
    manifestSchema.ts    — typed wrapper around ../lib/schema.js (validateManifest, reused)
    projection.ts        — pure: latest-approval -> manifest.build.flows[] projection
  middleware/auth.ts    — bearer-token auth for writes (mirrors ../server.js)
  repositories/         — one file per design_frames.* table
  routes/               — projects.ts, features.ts (v0.1.0 surface + v0.2.0 extensions), discussions.ts
  scripts/backfill.ts   — migration step 4
tests/                  — .test.cjs against the BUILT dist/ (mirrors the repo's existing test convention)
```

## Identity

### Hosted browser authentication

The browser sends its ordinary FuzeFront user session to the same-origin
FuzeFront proxy. Only that server supplies the upstream credentials:

```http
Authorization: Bearer <FuzeFront fuze-workload token>
X-Fuze-Delegation: Bearer <FuzeFront fuze-delegation token>
```

Both credentials are introspected through FuzeFront Security. The workload
must have `tokenKind=fuze-workload`; the delegation must have
`tokenKind=fuze-delegation`, audience `service:fuzex`, and `actor.sub` matching
the workload subject. A tenant-bound workload must match the delegated tenant.
The delegation requires `fuzex:frames:read` for reads and
`DESIGN_FRAMES_REQUIRED_SCOPE` (default `fuzex:frames:write`) for mutations.
Malformed, inactive, mismatched or unverifiable credentials fail closed.

Existing anonymous reads remain available. Supplying a delegation makes its
validation mandatory even for a read; it never falls back to anonymous access.
CLI/service writes may continue to use their verified machine bearer with the
write scope. A delegation token by itself is not a machine credential.

Approvals, comments, design-system revisions and generation drafts attribute
their actor to the verified delegated user (`user`) or machine (`agent`).
Legacy `approvedBy`, `rejectedBy`, `actorType`, and `authorType` inputs remain
accepted by their existing request schemas, but cannot override this identity.
Neither a machine token nor a delegation token belongs in browser storage.

Mints `fxdf_prj_*` / `fxdf_ftr_*` / `fxdf_flw_*` / `fxdf_frm_*` / `fxdf_apr_*`
/ `fxdf_dsc_*` / `fxdf_cmt_*` ids via `@fuzex/identity`
(`../../../packages/identity`) — this repo's OWN identity registry, not
`@izzywdev/fuzefront-identity`. See that package's README for exactly why
(short version: the shared package's registry is a closed literal that
cannot be extended from a consuming repo, and per
`governance/identifier-standard.md` §2 that is correct — each repo keeps its
own registry).

## App workspaces and design systems

An existing project is an application workspace. `GET /api/v1/projects/{id}/workspace`
returns its project metadata, feature/flow/frame counts from the authoritative
manifests, and the latest design-system snapshot (or `null` initially). Existing
`/projects` CRUD and `/projects/{id}/features` pagination remain available.

Design systems are complete, immutable snapshots of nested token metadata and
component definitions. Append a snapshot with
`POST /api/v1/projects/{id}/design-system/revisions`:

```json
{
  "expectedRevision": 0,
  "name": "App foundations",
  "tokens": { "color": { "accent": { "$type": "color", "$value": "#0066ff" } } },
  "components": [
    { "key": "button.primary", "name": "Primary button", "status": "draft" }
  ]
}
```

The verified caller supplies the persisted `createdBy` audit subject. Never send
`id`, `projectId`, `revision`, `createdBy`, or `createdAt` in the body. Set
`expectedRevision` to the current latest revision for later snapshots; concurrent
or stale writers get `409`. A project-row lock serializes initial and subsequent
writers. Revision numbers belong to their project; `{projectId, revision}` is the
complete reference. Database triggers reject update/delete of old snapshots.

Component `status` is `draft`, `approved`, or `rejected`; rejected components
require a non-empty `reason`. Changing tokens, components, or decisions appends a
new complete snapshot. `GET /projects/{id}/design-system` reads the latest;
`GET /projects/{id}/design-system/revisions/{revision}` reads history, and
`GET /projects/{id}/design-system/revisions?limit=50&cursor=...` paginates history
in ascending revision order. Follow `page.nextCursor` until `hasMore` is false.

Flow-generation/import integrations should pin `designSystemProjectId` and
`designSystemRevision` together in revision provenance and read that exact
snapshot; resolving the latest at preview time would change what an older flow
was designed against. If a pinned revision is unavailable, reject generation
instead of silently selecting a newer revision.

Apply migration `0010_create_design_system_revision.sql` before deploying this
API. `tests/design-system.test.cjs` validates snapshot bodies without Postgres;
`tests/design-system-integration.test.cjs` exercises persistence, stale/concurrent
writes, project isolation, historical reads, authentication, and database
immutability using an isolated scratch database when `DATABASE_URL` is supplied.
