# design-frames-service — Postgres lifecycle tier (design)

Status: **FROZEN CONTRACT** (this doc + `../openapi.yaml` v0.2.0 + the `fxdf`
identity namespace in `../../../.fuze/manifest.json`). Implementation has **not**
started — see [Ownership & sequencing](#ownership--sequencing).

This is the contract-designer artifact for evolving `design-frames-service` from
a flat-file store (`lib/store.js`) to a **Postgres-backed lifecycle tier**. It
records the two-tier persistence model, the entity/identifier model, the
invariants the schema and handlers must uphold, the backward-compatibility
strategy, and the migration path — so the database-engineer and backend-engineer
streams that follow build against one agreed interface rather than inventing one.

## Why

Today the service persists everything as flat files under `data/features/<slug>/`
(`lib/store.js`): one `manifest.json` + one HTML file per frame, serialized
per-slug. That is enough for content and single-flow approval booleans, but it
cannot answer the lifecycle questions the pipeline now needs:

- an **append-only decision history** per flow (who approved/rejected which
  stamp, when, and why) — today `setFlowApproval()` (`lib/store.js`)
  **overwrites** `approved/approvedBy/approvedAt` in place, destroying history;
- **projects** grouping many features across consuming products;
- **discussions + threaded comments** anchored to any node of the design graph
  (project / feature / flow / frame / element), including element-level anchors
  keyed off the existing `data-*` `testHook` selectors;
- **indexed queries** (list projects, list a flow's approvals, list discussions
  for a target) that a directory scan cannot serve efficiently.

## Two-tier persistence — content in git, lifecycle in Postgres

The single most important boundary: **frame CONTENT never enters Postgres.**

| Tier | Holds | Where | Keyed by |
|------|-------|-------|----------|
| **Content** | `manifest.json` + frame `*.html` (the bytes a reviewer sees) | git — the owning product's `design/frames/<feature>/` (mirrored into this service's `data/` store today) | slug + file path |
| **Lifecycle / index** | projects, features (index rows + refs, not HTML), flows, frame **refs**, approvals, discussions, comments | **Postgres** (`design_frames` schema) | `fxdf_*` TypeIDs + `content_stamp` |

Postgres stores **references and metadata only** — a `frame_ref` row points at a
frame by (feature, file, and the frame's `content_stamp`), never the HTML. This
keeps the design source of truth diffable/reviewable in git (the whole reason
frames are code, per FuzeFront's design-first policy) while giving the lifecycle
data a real relational home.

The bind between the two tiers is the **content stamp** computed by
`lib/stamp.js` (`computeStamp` — sha256 over `manifest.json` + every frame file,
with the approval-bookkeeping fields stripped so writing the stamp never changes
it). Every lifecycle row that asserts something about "the frames as they were"
(an approval, an element discussion) stores the `content_stamp` it was made
against, so a decision can always be checked against the exact bytes it referred
to even after the frames evolve.

### Frame-content storage evolution (PVC → object storage)

The content tier stays file-backed for now (the service's `data/` volume, a PVC
in-cluster). Because Postgres holds only refs + stamps, the content backend can
later move to object storage (S3/MinIO) **without touching the lifecycle schema
or this contract** — a `frame_ref` would simply resolve to an object key instead
of a PVC path. That migration is deliberately out of scope here; the two-tier
split is what makes it a later, isolated change.

## Entity & identifier model

Entities use the **product-local `fxdf` identifier namespace** reserved in
`.fuze/manifest.json` (`identity.namespace = "fxdf"`). Ids are **TypeIDs**:
`<prefix>_<base32 UUIDv7>`, opaque past the prefix, minted **only** by the owning
service (never client-supplied) per `governance/identifier-standard.md` (the
FuzeSDLC baseline standard). Every polymorphic reference carries its **type**.

| Entity | Prefix | Notes |
|--------|--------|-------|
| project | `fxdf_prj` | groups features across a consuming product |
| feature | `fxdf_ftr` | the design-frames feature (still addressable by `slug` on the wire) |
| flow | `fxdf_flw` | an approvable flow within a feature |
| frame_ref | `fxdf_frm` | **ref only** — (feature, file, stamp) pointer; never HTML |
| approval | `fxdf_apr` | **append-only** decision-log row (approve/reject discriminated) |
| discussion | `fxdf_dsc` | polymorphic target `{project\|feature\|flow\|frame\|element}` |
| comment | `fxdf_cmt` | **append-only**, threaded (nullable self-FK), soft-delete |

Relationships:

```
project 1─N feature 1─N flow 1─N approval
                    │
                    └─N frame_ref            (frame_ref.flow_id nullable)
discussion 1─N comment
```

- `feature.project_id` is a **nullable reference** (`fxdf_prj_*`) — a feature can
  exist unassigned; assigning it is not identity. Surfaced as the optional
  `projectId` on `POST /api/v1/features`.
- `frame_ref.flow_id` is nullable: a frame may belong to the feature but to no
  single flow.

### Identifier invariants the schema/handlers MUST hold

1. **The owning service mints every id** (identifier-standard §1). No create body
   accepts an `id`/`uuid` for the resource being created; every create body sets
   `additionalProperties: false`. Verified in `openapi.yaml`: `ProjectCreate`,
   `DiscussionCreate`, `CommentCreate`, and the extended feature-create body all
   comply. A client-chosen id turns a cross-type collision from something an
   attacker must *find* into something they *type in* (OWASP API3:2023 BOPLA).
2. **Every polymorphic reference carries its type** (identifier-standard §2). A
   `discussion` names its target as the pair `(targetType, targetRef)`; an
   `approval`/`comment` names its actor/author as `(actorRef, actorType)`. No
   lookup resolves a bare id.
3. **An id is never a capability.** Reads are public by design; writes require
   the existing bearer token (unchanged from v0.1.0). "The caller knew the id" is
   never authorization.

The `fxdf_*` prefixes are recognized by `gate-identifier` only because
`.fuze/manifest.json` now declares `identity.namespace`. The identity **package**
(`mintId()`) is wired by the backend stream, not here — the namespace is reserved
now so the contract's prefixes validate.

## Append-only approval log + stamp-binding invariant

This is the core behavioural change and the reason the flat file is insufficient.

- The `approval` table is **append-only**: approve and reject are two values of a
  `decision` discriminator, each a new row. A change of mind **appends** a new
  row — it never updates or deletes a prior one. History is the point.
- Every row is **stamp-bound**: `actor(ref+type)`, `content_stamp`, `decided_at`,
  and (for reject) a required `reason`. The `content_stamp` is the sha256 from
  `lib/stamp.js` for the frames the actor saw.
- On approve, if the caller supplies `contentStamp` it MUST equal the feature's
  current stamp, else the write is rejected with **409** (`StampConflict`) — a
  stale review cannot silently approve frames that changed underneath it.
- The current flat-file `manifest.build.flows[].approved/approvedBy/approvedAt`
  becomes a **projection** of "the latest approval row for this flow", not the
  source of truth. `lib/stamp.js` already strips those bookkeeping fields before
  hashing, so the projection never perturbs the stamp.

`GET /api/v1/features/{slug}/flows/{flowId}/approvals` exposes the full history
(newest first, paginated).

## Backward-compatibility — the manifest-projection strategy

The **entire v0.1.0 `/api/v1/features/**` surface is unchanged** (verified: the
only diff to existing operations is the additive optional `projectId` on
feature-create and the extension of the approve/reject bodies + responses; no
existing path, method, or response shape was removed or narrowed). The new tier
**projects** the old shapes from the new model:

- `GET /api/v1/features` / `GET /api/v1/features/{slug}` return the same
  `manifest`/`frames` shapes, assembled from the index rows + git content.
- `manifest.build.flows[].approved*` is derived from the latest approval row.
- Old `POST …/approve` callers sending only `{ approvedBy }` still succeed
  (append an approve row with a null stamp). Reject now **requires** `reason`
  (v0.2.0) — an append-only decision row must carry its rationale; this is the
  one deliberate tightening, called out in the `x-changelog`.

Pagination on the new collection GETs follows the baseline envelope
(`{ items, page: { nextCursor, hasMore, total? } }`, `limit` default 50/max 200 +
opaque `cursor`). The pre-existing `GET /api/v1/features` list is left on its
original unpaginated `{ features: [...] }` shape for byte-compatibility.

## Migration path (no flat-file removal)

1. **Provision (FuzeInfra, via `@claude`).** FuzeInfra provisions the Postgres
   database, the `design_frames` schema, a least-privilege role, and the
   `DATABASE_URL` **SealedSecret**. This repo **never** provisions databases and
   adds no provisioning here (no SQL, no Helm). See [Ownership](#ownership--sequencing).
2. **Schema (database-engineer).** Author the migrations for the seven tables +
   indexes (append-only constraints on `approval`/`comment`; nullable self-FK on
   `comment`; the `(targetType, targetRef)` and `(flow_id, decided_at)` indexes).
3. **Dual-write (backend-engineer).** Introduce the Express + `pg` + TypeScript
   tier **isolated** from the vanilla `bridge-server.js`/`server.js`. Writes go to
   Postgres **and** keep updating the flat-file manifest projection, so nothing
   that reads files breaks during rollout.
4. **Backfill.** Walk `data/features/**`, compute each feature's stamp via
   `lib/stamp.js`, and seed project/feature/flow/frame_ref rows + one approval row
   per already-approved flow (stamp = the feature's current stamp).
5. **Cut reads over** to Postgres for the lifecycle surfaces (approvals history,
   projects, discussions) while feature/frame reads still resolve content from git.
6. **Do NOT remove the flat-file store.** Frame content stays in git/`data/`
   permanently (tier 1). The flat files are the content source of truth, not a
   legacy to delete.

## Ownership & sequencing

Contract-first fan-out (FuzeSDLC baseline). This PR is the **gate**; every stream
below starts only after it is frozen/merged.

| Step | Owner | Deliverable |
|------|-------|-------------|
| 1 | **contract-designer** (this PR) | `openapi.yaml` v0.2.0, `fxdf` namespace, this doc |
| 2 | **FuzeInfra** via `@claude` | Postgres DB + `design_frames` schema + role + `DATABASE_URL` SealedSecret |
| 3 | **database-engineer** | migrations for the 7 tables + indexes + append-only constraints |
| 4 | **backend-engineer** | Express+`pg`+TS tier, dual-write, backfill, projection of the v0.1.0 surface; wire the identity package (`mintId()`) |
| 5 | **test-engineer** | acceptance/contract tests against `openapi.yaml` |

Out of scope for this repo entirely: the database and cluster provisioning
(FuzeInfra), and any hand-deploy to prod (GitOps only).

## Referenced files

- `../openapi.yaml` — the frozen HTTP contract (v0.2.0).
- `../../../.fuze/manifest.json` — `identity.namespace = "fxdf"`.
- `../lib/stamp.js` — `computeStamp()`; the content-stamp algorithm the log binds to.
- `../lib/store.js` — the current flat-file store; `setFlowApproval()` is what the append-only log replaces.
- `../server.js` — the current vanilla request router (unchanged; the new tier is isolated).
- `governance/identifier-standard.md` (FuzeSDLC baseline) — the id-minting + polymorphic-reference rules encoded above.
