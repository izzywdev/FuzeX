---
name: design-frames-lifecycle
description: Use once a feature's navigable HTML frames (design/frames/<feature>/**, or wherever your repo authors them) are written and locally schema-valid — sync them into FuzeX's design-frames-service for per-flow approval/reject tracking and a navigable review site. Frames stay authored and version-controlled in YOUR repo, like a .fig file; FuzeX manages their lifecycle, not their storage.
---

# design-frames-lifecycle

**Canonical source of this skill:** `izzywdev/FuzeX`, `services/design-frames-service/skills/design-frames-lifecycle/SKILL.md`.
Consuming repos install a copy under their own `.claude/skills/design-frames-lifecycle/SKILL.md` (see
"Installing this in a consuming repo" below) so their agents load it automatically.

## What this is (and isn't)

design-frames-service does **not** author frames and does **not** become their storage. A
feature's frames are this feature's own versioned design asset — analogous to a `.fig`
file: it lives, diffs, and is reviewed in **your repo's** git history, exactly where your
frame-authoring skill (e.g. FuzeFront's `ui-frame-contract`) already puts it.

What design-frames-service owns is the **lifecycle layered on top of that content**:
- Per-flow **approve/reject**, with the decision bound to a content stamp so a stale
  approval can never silently apply to changed frames.
- A **navigable review site** (`GET /site/:slug`) so a reviewer can click through the
  flow without cloning the repo.
- (Roadmap) a real database once ingested content needs to be queried relationally
  across products — today it's file-backed, same as the local pipeline it fronts.

Today the ingested copy is stored file-backed inside design-frames-service too — think of
that the way you'd think of a design tool's server-side copy of an uploaded `.fig` file:
it's what the *tool* needs to serve review/approval, not a second source of truth for
content. Your repo's `design/frames/<feature>/` is always the one to edit.

## Procedure

1. **Author and locally validate the frames exactly as your repo's own frame-authoring
   skill describes** — nothing about that step changes. (FuzeFront: `ui-frame-contract`.)
   This skill starts only once you have a schema-valid manifest and its frame files on
   disk.
2. **Install the client**, if this repo doesn't have a copy yet: copy
   `services/design-frames-service/client/design-frames-client.mjs` from this repo into
   your repo's `scripts/` (or vendor it however your repo manages dependency-light
   scripts — it's stdlib-only, no install step).
3. **Configure**, once per environment:
   ```bash
   export DESIGN_FRAMES_SERVICE_URL=https://<deployed-host>
   export DESIGN_FRAMES_API_TOKEN=<write token>   # only needed for sync/approve/reject
   ```
4. **Sync** the feature — creates the feature shell if it doesn't exist yet, pushes every
   frame file the manifest references, pushes the manifest, and commits a fresh content
   stamp:
   ```bash
   node scripts/design-frames-client.mjs sync <slug> design/frames/<slug> <your-repo-name>
   ```
   Re-run this **every time the local frames change** — it's a publish step, not a
   one-time migration. `<your-repo-name>` becomes the manifest's `sourceRepo`, so one
   deployment of design-frames-service can serve multiple consuming products without
   their slugs colliding in the UI.
5. **Share the navigable review site** for approval: `node scripts/design-frames-client.mjs get <slug>`
   prints the manifest; the site itself is at the URL `siteUrl(slug)` returns (also
   printed by `sync`).
6. **Approve or reject per flow** — either through the service's own frontend, or from
   the client:
   ```bash
   node scripts/design-frames-client.mjs approve <slug> <flowId> <approvedBy>
   node scripts/design-frames-client.mjs reject  <slug> <flowId> "<notes for the redispatch>"
   ```
7. **If your repo's own local gate also checks a manifest-level approval marker**
   (e.g. a CI stamp gate), keep that local marker in sync by hand or via your own
   automation — design-frames-service's approval state does not write back into your
   repo. Decide once per repo whether local approval or design-frames-service approval
   is authoritative for that repo's CI gate; document the choice where that gate lives.

## Installing this in a consuming repo

Copy this file to `.claude/skills/design-frames-lifecycle/SKILL.md` in the consuming
repo, and copy `client/design-frames-client.mjs` to that repo's `scripts/`. Update the
frame-authoring skill it pairs with (e.g. `ui-frame-contract`) to reference this skill
as the step that comes *after* local approval, not a replacement for local authorship.

## Non-goals

- Not a Module-Federation embed — this is an API integration; the consuming repo's shell
  is unaffected.
- Not the source of truth for frame *content* — that's always the consuming repo's own
  `design/frames/<feature>/**` (or equivalent).
- Not Authentik/Permit-authenticated yet — writes use a static bearer token
  (a FuzeFront-issued machine token with the `fuzex:frames:write` scope,
  verified against FuzeFront's introspection endpoint — issue #26).
