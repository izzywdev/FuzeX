# Hosted FuzeX rollout

The production source of truth is `deploy/helm/fuzex/values-prod.yaml`, reconciled
by the existing `fuzex` Argo Application. Image publication, migrations, deployment
and traffic routing must be checked separately. A rendered chart is not evidence
that the database, credentials or live images exist.

## Storage and ownership

Postgres stores project, feature, revision identity, approval and discussion
records. Immutable frame HTML and manifest snapshots currently remain on the
`fuzex` data PVC. A database-only backup cannot restore the review workspace.
Back up both stores to the same review boundary before import or rollout. Retain
the old PVC until a restore has been verified. Argo `Prune=false,Delete=false`
and Helm `resource-policy: keep` protect the claim from application cleanup;
they do not replace backups.

The filesystem content tier supports one writer. Keep its writer at one replica
with `Recreate` until content moves into a transactional shared store. Do not
enable horizontal scaling simply because lifecycle records are in Postgres.

FuzeX owns its application charts, routes and Argo manifests. FuzeInfra owns
shared Postgres, database users, cluster storage and backup/restore operations.
The exact provisioning handoff is
[`infra-requests/design-frames-postgres.md`](infra-requests/design-frames-postgres.md).
Production changes go through GitOps; do not run a hand deployment.

The portal remote uses the same-origin API base `/apps/fuzex/api`. Traefik strips
that prefix once: browser `/apps/fuzex/api/api/v1/projects` reaches backend
`/api/v1/projects`, and `/apps/fuzex/api/site/<slug>/<frame>` reaches `/site/...`.
The frontend's explicit `window.DESIGN_FRAMES_API_BASE` override is for local
or alternate same-origin mounts. Never capture the portal's generic `/api` routes
or strip the `/apps/fuzex/` prefix from Module Federation assets.

When the hosted tier is enabled, the chart scales the retained legacy Deployment
to zero in sync wave 0 and starts the hosted writer in wave 1. This is deliberate:
the Application has `prune: false`, so omitting the old Deployment would leave
its writer alive and prevent a reliable RWO volume cutover. The stable legacy
Service selects the hosted writer as well, preventing cluster callers from
continuing to write through the obsolete filesystem-only API.

Run `HELM_BIN=helm python scripts/check-hosted-chart.py` (requires PyYAML) to
validate both sides of this cutover, namespaced routes and unsafe-values guards.

## Rollout acceptance

1. Verify a published, pullable image for each enabled container. Release image
   tags must identify the tested source revision.
2. Verify `fuzex-design-frames-db/DATABASE_URL` exists in `fuzex`, references the
   provisioned database and least-privilege role, and contains no production
   credentials in Git. Verify FuzeFront introspection is reachable and an
   authorized machine identity has `fuzex:frames:write`.
3. Record database backup and PVC snapshot identifiers. Record a restore rehearsal
   that reads the same historical frame, discussion thread and review decision.
4. Enable the lifecycle tier only after storage, migration and authentication
   prerequisites are satisfied. Run chart validation against both the legacy
   and hosted values. Argo must complete the migration Sync Job in wave -1 before API
   rollout. A failed migration keeps the rollout blocked; inspect its logs before
   retrying. The Job has a deadline and is replaced on the next sync so a failed
   Job does not permanently block retries.
5. Read the health checks through the same origin used by the portal. Confirm the
   remote entry and every API request reach FuzeX rather than the FuzeFront SPA
   fallback. Reject a `200 text/html` response from an API as a routing failure.
6. Import one representative app, compare its flow/frame/revision counts with the
   source inventory, and preserve its original approval history. Importing it
   twice must not duplicate projects, revisions or historical decisions.
7. Review a component in the imported immutable revision, reply to feedback,
   resolve/reopen the thread, and approve/reject a frame. Verify an older revision
   retains its bytes and decisions after a newer import.
8. Restart the writer through the normal deployment path. Verify the project list,
   old frame bytes and review history survive. Check API latency/error logs and
   storage/database capacity before importing the remaining apps.

## Observability

The lifecycle API writes JSON logs with service, request id, route, method, status
and timed database/filesystem operations. Collect container logs through the
cluster's existing log pipeline. Alert on failed Argo migrations, API unavailable,
readiness failures, sustained 5xx responses, exhausted Postgres connections and
PVC/database capacity. A live process can be healthy while storage is unavailable;
use dependency-aware readiness to gate traffic and keep liveness independent of
an external database outage.

For production status, use FuzeInfra's read-only `cluster-query` workflow to fetch
pods, deployments, events, PVCs and hook Job logs. Cluster mutations and backup
operations belong to the delegated FuzeInfra work item.

## Automated database and credential provisioning

FuzeInfra's `serviceDatabases` entry `fuzex` provisions role `fuzex_svc` and
database `fuzex_design_frames` on the shared Postgres service. Its provider
credential is `fuzeinfra/fuzex-db-credentials:password`; agents never read it.
Dispatch FuzeInfra's `publish-sealed-handoff` with `id=fuzex-postgres` after
provisioning. The workflow composes and seals the connection URL for
`fuzex/fuzex-design-frames-db:DATABASE_URL`, then opens a ciphertext-only PR
updating `deploy/helm/fuzex/files/secrets/design-frames-db-sealed.yaml`.
The registry's verifier checks role/database connectivity without printing a
credential. The scheduled publisher refreshes delivery after future rotations.

The chart renders the delivered SealedSecret in wave -2, before the migration
Sync hook in wave -1 and writer rollout in waves 0/1. This ordering also works
on first installation; a PreSync migration could block its own Secret delivery.
A checksum of the sealed file rolls the API when the credential changes. Do not
copy a password through logs, dispatch inputs, Jira, or the agent workspace.

## Rollback

Revert the image/value change in Git and allow Argo to reconcile. Do not delete
the database, PVC, snapshot directories or migration tracking table. Applied
migrations are forward-only: reverting an image does not revert schema. Verify
the previous image accepts the expanded schema before rollback. If it cannot,
roll forward with a repair rather than dropping review evidence.

Stop writes before a data restore. Restore matching database and content-volume
backups into an isolated workspace first, compare immutable revision hashes and
approval/discussion counts, and delegate a production restore/cutover to FuzeInfra.
Keep source GitHub Pages and Issues available until every app passes import and
restore validation.
