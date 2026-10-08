# Draft UX-flow generation

Generation accepts a structured brief and creates a reviewable draft. The bundled
`deterministic-wireframe-v1` provider produces static HTML scaffolds without model
credentials. It does not claim to infer components or copy a design-system library;
it records the feature's design-system name as context. An external generation
provider can be added behind the same draft contract later.

All write endpoints use the existing verified FuzeFront identity and write scope.
The actor is taken from that identity. The client cannot claim a different actor,
upload renderer HTML, or request automatic approval.

## Endpoints

- `POST /api/v1/features/:slug/generations`: body `{baseStamp, brief}`. Returns
  `201` with `{id, status: "draft", baseStamp, resultStamp: null, actorRef,
  createdAt, updatedAt, draft}`. The brief requires `flowId`, `title`, `goal`, and
  `steps`; `audience` is optional. Each step requires `title` and `description`,
  with an optional `action` label. Limits: 12 steps, flow key 64 characters,
  title/action 160, goal/description 2000, audience 500. Unknown fields fail.
- `GET /api/v1/features/:slug/generations`: returns `{generations: [...]}` with
  the most recent 100 summaries (engine, flowId, title, frameCount and lifecycle
  fields), sorted newest first.
- `GET /api/v1/features/:slug/generations/:id`: returns the stored draft,
  including rendered frames and structured brief.
- `POST /api/v1/features/:slug/generations/:id/apply`: body `{baseStamp}`.
  Publishes the draft as a new immutable feature revision, preserving all existing
  frames and flows and leaving the generated flow unapproved. Returns the applied
  generation and `resultStamp`. A stale base returns `409`; regenerate against
  the latest content instead of overwriting it. Applying an applied draft is
  idempotent, including after a database completion failure.
- `POST /api/v1/features/:slug/generations/:id/dismiss`: empty object body.
  Dismisses a draft. A dismissed draft cannot be applied, and an applied draft
  cannot be dismissed. Dismissing an already dismissed draft is idempotent.

Draft inputs, provider version, output descriptors and transitions are durable in
`design_frames.generation`; rendered frame HTML never enters Postgres. The frozen
v1 provider reconstructs draft previews deterministically from those inputs. A
future model provider must persist its output bytes in the durable content tier
and store references in Postgres; it must not regenerate nondeterministic output
when an existing draft is read. The wire id uses the server-owned `fxdf_gen`
identity prefix. Publication uses the same
content-addressed snapshots and revision-scoped frame references as imported
content, so annotations and approvals can bind to the exact result.

Example brief:

```json
{
  "flowId": "team-onboarding",
  "title": "Join a team",
  "goal": "A new member joins their existing team",
  "audience": "New members",
  "steps": [
    {"title": "Welcome", "description": "Explain the workspace", "action": "Continue"},
    {"title": "Choose team", "description": "Choose an existing team", "action": "Join team"}
  ]
}
```
