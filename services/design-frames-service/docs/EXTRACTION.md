# Extraction record: FuzeFront's navigable-frames pipeline → FuzeX

**Date:** 2026-08-10
**Origin PR (FuzeFront):** see `docs/planning/design-first-ui-pipeline.md` in
that repo for the pipeline this was ported from.

## Why

FuzeFront's "design-first" gate (its `CLAUDE.md` §"Design-first gate") built
navigable HTML frames as the authoritative pre-implementation design
artifact: `design/frames/<feature>/index.html` + numbered screens +
`manifest.json`, content-stamped, approved per-flow via a GitHub Issue, and
published to GitHub Pages. It worked, but it was implemented as files +
scripts + CI glue *inside FuzeFront's own repo* — closer to what a standalone
design-tool product looks like than a feature of a Module-Federation host
shell. FuzeX — an AI-driven design/Figma-adjacent tool — is a more natural
home for it than FuzeFront's own repo, and hosting it there lets it be
consumed by more than one product.

## What was ported vs. reimplemented

Nothing was copied byte-for-byte; FuzeFront's originals stayed in FuzeFront
(the 14 existing `design/frames/<feature>/` dirs are untouched — see the
FuzeFront-side PR). This service reimplements the same mechanisms:

| FuzeFront original | This service | Notes |
|---|---|---|
| `scripts/stamp-frames.mjs` (sha256 over feature dir, approval keys excluded) | `lib/stamp.js` | Same algorithm, works over in-memory manifest+frames instead of a directory walk. |
| `design/frames/_template/manifest.schema.json` | `lib/manifest.schema.json` + `lib/schema.js` | Same shape, `frames[]` allowed empty (incremental authorship via the API, vs. FuzeFront's whole-feature-at-once file authorship). |
| `design-approval.yml` (GitHub Issue → deploy-key push to `master`) | `POST /api/v1/features/:slug/flows/:flowId/approve` | Real API + persisted state instead of a GitHub Issue parse + git push. |
| `pages-frames.yml` / `build-frames-site.mjs` (GitHub Pages static site) | `GET /site/:slug`, `GET /site/:slug/:file` | Server-rendered instead of statically built/published. |
| `gate-ds-conformance` | *(not ported)* | FuzeFront-specific (scans `frontend/`, `packages/*ui*` for raw hex/px). Out of scope for a design-tool service that doesn't own any product's frontend source. |
| `gate-frames-first`, `gate-frames-schema` | *(not ported — they didn't exist)* | FuzeFront's CLAUDE.md and planning doc describe these as live; verified against the actual repo, they were never implemented. Not carried over as fictitious gates. |

## What's intentionally different

- **Incremental authorship over an API**, not whole-feature file authorship.
  A feature starts as a shell (`POST /features`) and frames are added one at
  a time (`PUT .../frames/:file`), rather than being written to disk all at
  once and committed as a single PR.
- **File-backed storage, not a database** — matches this repo's
  dependency-light convention (see `bridge-server.js`'s single `uuid`
  dependency). Directory-per-feature layout deliberately mirrors FuzeFront's
  `design/frames/<feature>/` so a feature can be exported/imported 1:1 later.
- **Network-reachable by design.** `bridge-server.js` is a localhost-only dev
  bridge; this service is meant to be deployed and called by other products'
  CI, so it binds `0.0.0.0` and authenticates writes with a bearer token
  (`DESIGN_FRAMES_API_TOKENS`) instead of relying on a loopback bind.

## What's explicitly deferred (not done in this extraction)

- **FuzeFront's 14 existing features are not migrated.** They stay in
  FuzeFront's repo, frozen, until a follow-up decides to move them.
- **No Module-Federation embed.** FuzeFront consumes this service over its
  REST API from CI (plumbing-only integration); the frontend here is not
  mounted inside the FuzeFront shell. FuzeX currently has zero frontend build
  tooling (see `.fuze/manifest.json`'s `portal.registers: false` and its
  reasoning) — embedding would be new scope, not extraction.
- **No Authentik/Permit integration.** Auth is a static bearer token for now.
  Family-standard auth would mean wiring this service onto FuzeInfra, which
  is out of scope for a same-session change (FuzeInfra changes are delegated
  via `@claude`, never made directly — see this repo's `CLAUDE.md`).
- **No persisted datastore beyond the filesystem.** See README.md's Data
  model section for the reasoning.
