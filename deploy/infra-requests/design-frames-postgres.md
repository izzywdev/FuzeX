# Infra request — design-frames-service Postgres lifecycle tier

**To:** FuzeInfra, via `@claude` (this repo never provisions databases, roles,
or grants — see `services/design-frames-service/db/README.md` "Provisioning
boundary" and `docs/postgres-tier.md` "Migration path" step 1).

**From:** FuzeX (`izzywdev/FuzeX`) — `services/design-frames-service`'s new
Postgres lifecycle tier (contract: `services/design-frames-service/docs/postgres-tier.md`
v0.2.0; migrations: every tracked SQL file in `services/design-frames-service/db/migrations/`;
backend: `services/design-frames-service/backend/`).

## What this repo has ready, waiting on this request

- The Postgres lifecycle tier's Deployment + Service + a migration Sync hook
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

1. **Postgres database `fuzex_design_frames`** for this service on the shared Postgres instance FuzeInfra operates
   for the cluster.
2. **The `design_frames` schema is NOT pre-created by FuzeInfra** — leave the
   database schema-empty. `db/migrate.sh` creates
   `design_frames` (and its own `design_frames._migrations` tracking table)
   itself, idempotently, as the migration Job's first statement.
3. **Least-privilege role `fuzex_svc`** scoped to that database, with:
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
   - Provider: `fuzeinfra/fuzex-db-credentials:password`.
   - Host: `fuzeinfra-postgres.fuzeinfra.svc.cluster.local:5432`.
   - Automated hand-off: FuzeInfra `publish-sealed-handoff`, `id=fuzex-postgres`,
     format `postgres-url`. Ciphertext is published to
     `deploy/helm/fuzex/files/secrets/design-frames-db-sealed.yaml`; the Helm
     wrapper validates scope/key and applies it in Argo wave -2.
   - These exact name/key are already wired into
     `deploy/helm/fuzex/values.yaml` (`postgresTier.databaseSecret.name` /
     `.key`) — the Deployment and the migration Job both reference this
     secret already. The sealed file checksum rolls the API on rotation.

## Automated go-live sequence

1. FuzeInfra's standard provisioning workflow seals the provider password and
   enables `serviceDatabases.fuzex`; its shared Postgres provisioning Job creates
   database/role. Dispatch `publish-sealed-handoff` with `id=fuzex-postgres`
   to deliver the consumer ciphertext through a PR. Verify the hand-off and
   database connectivity using FuzeInfra's verifier workflow.
2. A push to `services/design-frames-service/**` on `master` builds/publishes
   `ghcr.io/izzywdev/fuzex-design-frames-postgres-tier` and bumps its tag in
   `deploy/helm/fuzex/values-prod.yaml` (already wired by this PR).
3. Enable `postgresTier.enabled: true` in `deploy/helm/fuzex/values-prod.yaml`
   through the authorized rollout PR once delivery and images are verified.
   Argo's next sync applies the SealedSecret in wave -2, runs `db-migrate` as
   a Sync hook in wave -1, then rolls the writer through waves 0/1. This also
   bootstraps correctly when the consumer Secret did not previously exist.

## Explicitly NOT requested here

- No replacement pre-shared API tokens; FuzeX writes use FuzeFront-issued
  identities. The obsolete `fuzex-api-tokens` mechanism is not used.
- No cluster/node changes, no Argo project/Application changes (this tier
  lives inside the existing single `fuzex` Argo Application — see
  `deploy/argocd/application.yaml`'s "ONE Application per repo" note).

## Additional hosted-workspace requirements (FUZX-6)

The lifecycle tier becomes the sole hosted writer of both lifecycle records and
immutable content snapshots. Enabling it scales the existing writer to zero in
sync wave 0 and starts the new writer in wave 1; the same durable Longhorn PVC
(`fuzex-design-frames-data`, namespace `fuzex`) is retained and mounted at
`/data/features`. There is no database-only restore: both database records and
volume bytes are required to reproduce a reviewed revision.

FuzeInfra must establish scheduled database backups and Longhorn volume snapshots,
retention and monitoring using existing cluster conventions, then rehearse a
paired restore into an isolated namespace/database. Record snapshot identifiers,
restored revision hashes and approval/discussion counts. Do not delete or replace
the existing content PVC during provisioning.

Confirm the installed Traefik exposes `traefik.io/v1alpha1` Middleware resources
and can use a same-namespace StripPrefix middleware for `/apps/fuzex/api`. FuzeX
owns that Middleware and Ingress; no generic portal API route is changed. Keep
the existing `/apps/fuzex/` Module Federation asset route as a pass-through.

## Ready-to-file FuzeInfra work item

**Summary:** Provision durable Postgres and paired content backups for the FuzeX hosted review workspace

**Type:** Story, with database provisioning, secret delivery, backup/restore and
cluster verification tasks. **Dependency:** blocks FUZX-6 hosted rollout.

**Description:** FuzeX now has a sole-writer hosted API chart, namespaced portal
API routing, dependency-aware readiness and a bounded Argo migration hook. The
production lifecycle tier remains intentionally disabled until FuzeInfra provides
its shared-database and durability prerequisites. Execute this work in FuzeInfra
through its normal GitOps/provisioning workflow. No FuzeX credentials or raw
connection strings may be posted to Jira/GitHub.

**Acceptance criteria:**

- Provision the service database and database-scoped role with the privileges
  described above; reject superuser/CREATEDB/CREATEROLE or access to other apps.
- Deliver `fuzex-design-frames-db` with key `DATABASE_URL` in namespace `fuzex`
  through SealedSecrets, reachable by the API and Argo migration Job.
- Verify the retained `fuzex-design-frames-data` Longhorn claim is bound and can
  move between eligible workload nodes; no filesystem-only writer remains active
  after the FuzeX GitOps cutover.
- Establish database backups and content-volume snapshots with documented
  retention, capacity alerts and failure notifications.
- Restore a matched database/content backup into isolation; verify an immutable
  historical frame hash and its review/discussion history match the backup.
- Verify Traefik's Middleware CRD and namespaced API prefix routing; `/health`
  remains live while `/ready` returns 503 during a database/storage outage.
- Record non-secret verification evidence and the provisioning change/PR link in
  the work item; notify the FUZX-6 owner so the lifecycle tier can be enabled and
  the full migration acceptance run completed.
