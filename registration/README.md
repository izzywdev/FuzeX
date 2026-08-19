# FuzeX registration payload

What this directory is, and the one thing about it that keeps getting "corrected" wrongly.

`manifest.json` + `policy.json` are what the **fail-closed** `fuzefront-register` init
container submits to the FuzeFront app registry at pod start
(`deploy/helm/fuzex/templates/deployment.yaml` → `register.sh`). The chart cannot read above
its own directory, so `deploy/helm/fuzex/files/registration/` holds byte-identical copies —
`scripts/sync-chart-files.sh` maintains them and `--check` fails CI on drift.

## `slug` keeps the `fuze` prefix. The **display name** is what de-prefixes.

```json
{ "slug": "fuzex", "name": "X", "menuLabel": "X" }
```

The requirement behind the convention is a readable portal nav — the owner does not want a
side menu of fifteen entries that all begin "Fuze". That is satisfied by the **display**
fields, and they are the fields that were carrying the prefix. `slug` is a different thing:
it is the URL segment (`/app/<slug>`), it is the registry's primary key, and it is
**immutable** — `PUT /apps/{slug}` requires it to match and there is no rename operation.

For FuzeX the prefix on the slug is also **load-bearing, not stylistic**:

- The contract's `Slug` pattern is `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` — a **minimum of
  three characters** (`FuzeFront/backend/applications/src/app-registry/manifest.schema.ts`,
  `FuzeFront/packages/onboarding-kit/manifest.schema.json`).
- `fuzex` de-prefixes to `x`. One character. It cannot match.
- So registering as `x` returns **400**, `register.sh` treats a non-201/409 as fatal, and the
  pod **CrashLoopBackOffs** — the precise failure the fail-closed init container exists to
  make loud.
- `@fuzefront/onboarding-kit`'s `validateSlugConvention()` encodes exactly this short-name
  exemption and passes `fuzex` verbatim; its test suite asserts it by name.

A `/^fuze/i` slug rejection does exist in four sibling repos (`fuzedeploy`, `fuzecall`,
`fuzeexecutive`, `fuzefinance`). It is **not** in FuzeSDLC's canonical
`check-registration.mjs` — it is local drift that has been quoted back as policy more than
once. Do not copy it here, and do not "de-prefix" this slug.

## Editing checklist

1. Change `registration/manifest.json` or `registration/policy.json`.
2. Run `scripts/sync-chart-files.sh` so the chart copies match.
3. Run `node scripts/check-registration.mjs`.
4. `nav.section` must be one of the platform's `NavSection` values — an invented one is a
   400 at deploy time, not a lint error here.
