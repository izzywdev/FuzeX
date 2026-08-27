# @fuzex/identity

Server-owned entity identifiers for FuzeX's own product-local entity types
(currently: `design-frames-service`'s `project`/`feature`/`flow`/`frameRef`/
`approval`/`discussion`/`comment`). Policy:
[`governance/identifier-standard.md`](https://github.com/izzywdev/FuzeFront/blob/master/governance/identifier-standard.md)
(FuzeSDLC baseline §4.2).

## Why this exists instead of depending on `@izzywdev/fuzefront-identity`

Two things were checked before writing this module (both recorded here for
review — see the design-frames-service backend implementation PR body for
the same note in context):

1. **Resolution.** `npm view @izzywdev/fuzefront-identity --registry
   https://npm.pkg.github.com` returned `401 Unauthorized` in the
   implementation environment (the available `GITHUB_TOKEN` is repo-scoped
   and does not carry `read:packages` for GitHub Packages). Whether a
   properly-scoped CI token resolves it was **not** re-verified — this repo
   does not depend on it either way, per point 2.
2. **Registry shape.** Reading the package's published source
   (`packages/identity/src/registry.ts` in `izzywdev/FuzeFront`) shows
   `ENTITY_PREFIXES` is a closed `as const` object literal compiled into the
   package — "adding a type here is the ONLY way to mint ids for it." A
   consuming repo cannot add `project`/`feature`/etc. to it without a PR to
   FuzeFront's package and a republish.

That is **not actually a gap** — `governance/identifier-standard.md` §2 says
explicitly: *"Each repo keeps its own registry. There is deliberately no
central one: a registry every product must PR into is a coordination
bottleneck... Repo names are unique within the org, so a product namespace
is self-allocating."* FuzeHub's `hub_ord_` and this repo's `fxdf_*` are the
same pattern. So this module is not a stopgap pending an upstream change —
it is the standard's intended, permanent shape for a repo with its own
entity types. `.fuze/manifest.json` declares `identity.namespace = "fxdf"`
(reserved in `services/design-frames-service/docs/postgres-tier.md`) and
every prefix in `src/registry.ts` carries it, satisfying
`gate_identifier.py --namespace`. `packages/identity/` existing at the repo
root satisfies `gate_identifier.py --adoption`'s "or being a repo with its
own identity module" check, and `packages/identity/src/` is the exact path
`gate_identifier.py`'s source backstop already exempts from the
"no bare `randomUUID()` for an entity id" rule.

## What's reused vs. reimplemented

The **wire format** (TypeID: prefix + UUIDv7 in Crockford base32) and the
**API shape** (`mintId`/`parseId`/`assertRef`/`toUuid`/`fromUuid`/
`EntityId<T>`) are deliberately identical to `@izzywdev/fuzefront-identity`
— same algorithm, independent code, the same pattern this service's
`lib/stamp.js` already uses for FuzeFront's stamp algorithm. Only the
**registry** (which entity types exist, which prefixes they own) is
FuzeX-local, which is exactly the axis the standard says should differ per
repo.

## Usage

```ts
import { mintId, assertRef, toUuid, type EntityId } from '@fuzex/identity';

const projectId = mintId('project');        // fxdf_prj_01h455…
await db.query('insert into project (id, ...) values ($1, ...)', [toUuid(projectId)]);

assertRef('project', body.projectId);       // L0: no network, no cache, no DB
```

## Development

```bash
npm install
npm run build && npm test
```
