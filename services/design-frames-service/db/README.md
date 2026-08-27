# design-frames-service — `design_frames` Postgres tier

Migrations for the lifecycle/index tier described in
[`../docs/postgres-tier.md`](../docs/postgres-tier.md) and backing
[`../openapi.yaml`](../openapi.yaml) v0.2.0. **Frame content (manifest.json +
frame `*.html`) is never stored here** — only lifecycle metadata, refs, and
append-only decision/discussion history. Content stays in git / the
service's `data/` volume.

## Provisioning boundary — read this first

**This repo never provisions databases, roles, or grants.** FuzeInfra
provisions the Postgres database, a least-privilege role for this service,
and the `DATABASE_URL` **SealedSecret**, before any migration here runs
in-cluster (delegated via `@claude` to the FuzeInfra repo — never hand-run
against the shared cluster). Nothing in `db/migrations/**` contains `CREATE
ROLE`, `CREATE DATABASE`, or a grant statement, and nothing here ever should.
These migrations assume they are running **inside** an already-provisioned,
already-authenticated database — they only create the `design_frames` schema
and the objects inside it.

## How to run migrations

```bash
DATABASE_URL=postgres://<role>:<password>@<host>:5432/<db> ./db/migrate.sh
```

`db/migrate.sh` is a tiny, dependency-free (no `node_modules`, no `pg`
client library) runner: it applies every `db/migrations/NNNN_*.sql` file in
filename order, each inside its own transaction, and records what it applied
in `design_frames._migrations` so re-running the script is a no-op for
already-applied files. Every migration file is *also* independently
idempotent (`CREATE ... IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` +
`CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`) — running a file twice, even
outside the tracker, is safe.

In-cluster, this script is the entrypoint for a **pre-sync Argo/Helm Job**
(devops-engineer wires the Job + which `DATABASE_URL` SealedSecret key it
consumes) — not an init-container racing multiple replicas, and not run at
app startup.

Locally: point `DATABASE_URL` at the FuzeInfra docker-compose/kind Postgres,
or any scratch Postgres you control. Never point it at a shared/prod
instance from a developer machine.

## Migration order (`db/migrations/`)

| File | Creates |
|---|---|
| `0001_create_schema.sql` | `design_frames` schema |
| `0002_functions.sql` | shared trigger functions: `touch_updated_at()`, `forbid_mutation()`, `comment_guard()` |
| `0003_create_project.sql` | `project` (`fxdf_prj_*`) |
| `0004_create_feature.sql` | `feature` (`fxdf_ftr_*`), nullable `project_id` FK |
| `0005_create_flow.sql` | `flow` (`fxdf_flw_*` internally), FK to `feature` |
| `0006_create_frame_ref.sql` | `frame_ref` (`fxdf_frm_*`) — ref only, never HTML |
| `0007_create_approval.sql` | `approval` (`fxdf_apr_*`) — append-only decision log |
| `0008_create_discussion.sql` | `discussion` (`fxdf_dsc_*`) — polymorphic target |
| `0009_create_comment.sql` | `comment` (`fxdf_cmt_*`) — append-only, threaded, soft-delete |

Ordered by FK dependency (`project` → `feature` → `flow` → `frame_ref` →
`approval`; `discussion` → `comment`). Add new migrations as
`0010_*.sql`, `0011_*.sql`, … — never renumber or edit a merged file
(forward-only).

## Native uuid storage / wire TypeID split

Every entity's Postgres primary key is a native 16-byte `uuid` column. There
is **no `DEFAULT gen_random_uuid()`/`uuid_generate_v4()`** on any PK — ids
are UUIDv7, minted **app-side** by `mintId()` (identity package, lands with
the backend-engineer implementation PR per `docs/postgres-tier.md`), never
by the database, per `governance/identifier-standard.md` §1 ("the owning
service mints its id"). The `fxdf_prj_*` / `fxdf_ftr_*` / `fxdf_flw_*` /
`fxdf_frm_*` / `fxdf_apr_*` / `fxdf_dsc_*` / `fxdf_cmt_*` TypeID prefixes are
a **wire-only** concern, encoded/decoded by the app's identity codec — the
prefix string is never stored as (or as part of) a primary key.

Verified: `information_schema.columns.column_default` is empty for every
`id` column in this schema (checked by hand against a scratch DB — see
"Verification" below).

## Append-only enforcement

- **`approval`** — `design_frames.forbid_mutation()` (BEFORE UPDATE OR
  DELETE trigger) unconditionally rejects both. A change of mind is always a
  new row; `decision` discriminates approve/reject.
- **`comment`** — `design_frames.comment_guard()` (BEFORE UPDATE OR DELETE)
  rejects hard DELETE always, and rejects every UPDATE **except** the single
  allowed transition: setting `deleted_at` (once, from `NULL`) while every
  other column stays pinned; the trigger also force-blanks `body` to `''` on
  that transition (tombstone shape), matching
  `openapi.yaml`'s `Comment.body`: "Empty string when deleted=true". A
  `comment_tombstone_shape` CHECK backs this up structurally (non-deleted
  rows must have a non-empty body; deleted rows must have an empty one).
- **Why a trigger and not just a CHECK**: a CHECK constraint can only see the
  row being written, not compare it against the row it is replacing — it
  cannot express "never change once written." A `BEFORE UPDATE OR DELETE`
  trigger is the standard Postgres mechanism for that; `RAISE EXCEPTION`
  aborts the statement and its transaction.
- **`reject` requires `reason`**: a plain CHECK on `approval`
  (`approval_reject_requires_reason`) — no trigger needed, since this only
  needs to see the row being inserted.

## Known gap — not enforced here

`frame_ref` is documented as a **ref**, and its `UNIQUE (feature_id, file,
content_stamp)` constraint makes re-inserting the identical ref fail
harmlessly, but **nothing blocks `UPDATE`/`DELETE` on an existing
`frame_ref` row** — `docs/postgres-tier.md` does not list it alongside
`approval`/`comment` as append-only, so no `forbid_mutation()` trigger was
added. If backend-engineer's implementation needs `frame_ref` rows to be
strictly immutable/insert-only too (matching the append-only spirit of the
rest of the lifecycle log), add a
`BEFORE UPDATE OR DELETE ... EXECUTE FUNCTION design_frames.forbid_mutation()`
trigger on it in a follow-up `0010_*.sql` migration — the function already
exists and is table-agnostic.

## Verification performed

All 9 migrations were dry-run against a local scratch Postgres 16 instance
(not the app's actual target, not shared/prod):

1. Applied cleanly in order, zero errors.
2. Re-ran via `db/migrate.sh` — every file skipped via `_migrations`
   tracking (no-op).
3. Re-ran every raw `.sql` file directly with `psql -f` (bypassing the
   tracker) — every `CREATE`/`CREATE INDEX`/`CREATE TRIGGER` no-op'd via its
   own `IF NOT EXISTS` / `DROP ... IF EXISTS` guard, zero errors. Proves the
   files are idempotent independent of the runner.
4. Exercised every invariant directly with `INSERT`/`UPDATE`/`DELETE`
   against a seeded project/feature/flow/discussion/comment: reject without
   `reason` rejected (CHECK); reject with `reason` succeeded; approve with a
   null `contentStamp` succeeded (legacy `{approvedBy}`-only path); `UPDATE`
   and `DELETE` on an `approval` row both rejected (append-only trigger);
   hard `DELETE` on a `comment` rejected; direct `body` mutation on a
   `comment` rejected; the single soft-delete transition (`deleted_at` set)
   succeeded and force-blanked `body`; re-soft-deleting an already-deleted
   `comment` rejected; a `discussion` with `target_type='element'` and no
   `target_selector` rejected (CHECK); a duplicate `(feature_id, file,
   content_stamp)` on `frame_ref` rejected (UNIQUE); confirmed
   `column_default` is empty on every `id` column (no DB-side id minting).

No `psql`/live-cluster access was used against any real environment — this
was a local, throwaway scratch database, consistent with "prod is GitOps,
never hand-mutated."
