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

Mints `fxdf_prj_*` / `fxdf_ftr_*` / `fxdf_flw_*` / `fxdf_frm_*` / `fxdf_apr_*`
/ `fxdf_dsc_*` / `fxdf_cmt_*` ids via `@fuzex/identity`
(`../../../packages/identity`) — this repo's OWN identity registry, not
`@izzywdev/fuzefront-identity`. See that package's README for exactly why
(short version: the shared package's registry is a closed literal that
cannot be extended from a consuming repo, and per
`governance/identifier-standard.md` §2 that is correct — each repo keeps its
own registry).
