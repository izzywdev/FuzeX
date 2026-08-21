# Infra request — design-frames-service Postgres lifecycle tier

**To:** FuzeInfra, via `@claude` (this repo never provisions databases, roles,
or grants — see `services/design-frames-service/db/README.md` "Provisioning
boundary" and `docs/postgres-tier.md` "Migration path" step 1).

**From:** FuzeX (`izzywdev/FuzeX`) — `services/design-frames-service`'s new
Postgres lifecycle tier (contract: `services/design-frames-service/docs/postgres-tier.md`
v0.2.0; migrations: `services/design-frames-service/db/migrations/0001`–`0009`;
backend: `services/design-frames-service/backend/`).

## What this repo has ready, waiting on this request

- The Postgres lifecycle tier's Deployment + Service + a pre-sync migration
  Job are templated in `deploy/helm/fuzex/templates/` (`postgres-tier-deployment.yaml`,
  `postgres-tier-service.yaml`, `db-migrate-job.yaml`), gated **OFF** by default
  via `postgresTier.enabled: false` in `deploy/helm/fuzex/values.yaml` /
  `values-prod.yaml`.
- The migration runner (`services/design-frames-service/db/migrate.sh`) is
  idempotent, dependency-free (only `psql`), and creates **only** the
  `design_frames` schema and the objects inside it — it contains no
  `CREATE ROLE`, `CREATE DATABASE`, or grant statement, and assumes it is
  running against an already-provisioned, already-authenticated database.
- The image that runs both the backend API and the migration Job
  (`ghcr.io/izzywdev/fuzex-design-frames-postgres-tier`) is built by
  `.github/workflows/release.yml` on the next push to master that touches
  `services/design-frames-service/**`.

## What FuzeInfra needs to provision

1. **A Postgres database** for this service (name at your discretion, e.g.
   `fuzex_design_frames`) on the shared Postgres instance FuzeInfra operates
   for the cluster.
2. **The `design_frames` schema is NOT pre-created by FuzeInfra** — leave the
   database schema-empty. `db/migrate.sh` creates
   `design_frames` (and its own `design_frames._migrations` tracking table)
   itself, idempotently, as the PreSync Job's first statement.
3. **A least-privilege role** scoped to that database, with:
   - `CONNECT` on the database,
   - `CREATE` on the database (needed once, to create the `design_frames`
     schema itself — see `db/migrations/0001_create_schema.sql`),
   - full DML/DDL (`USAGE, CREATE` on schema; `SELECT, INSERT, UPDATE,
     DELETE` on tables; `EXECUTE` on functions) within the `design_frames`
     schema once created — this service creates and owns every object in
     that schema, nothing outside it.
   - **No** superuser, no `CREATEDB`, no `CREATEROLE`, no access to any
     other service's schema/database.
4. **A `DATABASE_URL` SealedSecret in the `fuzex` namespace**, sealed against
   this cluster's published SealedSecrets controller cert, containing the
   full connection string for the role/database above:
   - **Secret name:** `fuzex-design-frames-db`
   - **Secret key:** `DATABASE_URL`
   - **Value shape:** `postgres://<role>:<password>@<host>:5432/<database>`
   - These exact name/key are already wired into
     `deploy/helm/fuzex/values.yaml` (`postgresTier.databaseSecret.name` /
     `.key`) — the Deployment and the migration Job both reference this
     secret already; nothing else needs to change in this repo once it
     exists.

## Go-live sequence (owner-driven, after this request is fulfilled)

1. FuzeInfra provisions the database + role + `fuzex-design-frames-db`
   SealedSecret per above.
2. A push to `services/design-frames-service/**` on `master` builds/publishes
   `ghcr.io/izzywdev/fuzex-design-frames-postgres-tier` and bumps its tag in
   `deploy/helm/fuzex/values-prod.yaml` (already wired by this PR).
3. Owner flips `postgresTier.enabled: true` in `deploy/helm/fuzex/values-prod.yaml`,
   in one PR, during a deploy window. Argo's next sync runs the `db-migrate`
   PreSync hook Job first, then rolls the `postgres-tier` Deployment.

## Explicitly NOT requested here

- No changes to the existing `fuzex-api-tokens` secret or the vanilla
  `design-frames-service` frontend/Deployment — unaffected by this request.
- No cluster/node changes, no Argo project/Application changes (this tier
  lives inside the existing single `fuzex` Argo Application — see
  `deploy/argocd/application.yaml`'s "ONE Application per repo" note).
