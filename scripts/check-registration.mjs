#!/usr/bin/env node
// Checks on FuzeX's FuzeFront registration payload that the shared
// validator does not make.
//
// `@fuzefront/onboarding-kit`'s validate-registration.mjs is a FLEET-POLICY
// checker by design — it asserts conventions "no schema can express" and
// deliberately does not re-validate against the AppManifest schema.
//
// That leaves nav.section unchecked anywhere in a product's own repository, and
// FuzeFinance is the precedent: it shipped `nav.section: "business"` — a
// perfectly plausible section name that is not in NavSection at all — and every
// gate passed it. The platform parses the manifest with
// `registerAppRequestSchema.safeParse` (backend/applications/src/routes/
// app-registry.ts), whose `navSchema.section` is `z.enum(NAV_SECTIONS)`, so an
// unknown section fails the parse, `POST /apps` answers 400, and register.sh
// treats any non-201/409 as fatal — the pod CrashLoopBackOffs and the product
// never appears in the portal.
//
// FuzeX's own section is already valid. This check is here so it stays
// that way: an edit to nav should cost a red build, not a CrashLoop.
//
// Exit 0 = coherent. Exit 1 = do not merge.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(ROOT, 'registration')
const VENDORED = join(ROOT, 'deploy/helm/fuzex/files/registration')

// Mirrors NAV_SECTIONS in FuzeFront's
// backend/applications/src/app-registry/manifest.schema.ts. The ARRAY ORDER is
// the portal's render order, so this list is also the menu's lifecycle:
// steer -> plan -> build -> sell -> serve -> measure -> operate.
const NAV_SECTIONS = [
  'executive',
  'plan',
  'build',
  'revenue',
  'customer',
  'insight',
  'platform',
]

const problems = []

let manifest = null
try {
  manifest = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'))
} catch (err) {
  console.error(`✘ registration/manifest.json is unreadable or invalid JSON: ${err.message}`)
  process.exit(1)
}

const section = manifest.nav?.section
if (section === undefined) {
  problems.push('nav.section is absent — the app would sort last, in "platform", by default rather than by decision')
} else if (!NAV_SECTIONS.includes(section)) {
  problems.push(
    `nav.section "${section}" is not a NavSection. The platform rejects the manifest with 400 and register.sh treats that as fatal, so the pod CrashLoopBackOffs. Valid: ${NAV_SECTIONS.join(', ')}`
  )
}

// NO `fuze`-PREFIX CHECK HERE, AND THAT IS DELIBERATE. `fuzex` de-prefixes to
// `x`, which is ONE character — below the contract's Slug minimum of three
// (`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`). There is no conformant slug to move to,
// so the prefix is load-bearing rather than a style violation. The shared kit
// validator encodes exactly this exemption; copying a naive prefix check in here
// would contradict it and fail the build for a rule FuzeX cannot satisfy. Run
// the kit's validate-registration.mjs for the prefix rule itself.

// Drift between registration/ and the chart's vendored copy. Helm's .Files cannot
// read above the chart directory, so the copy under files/ is what actually
// deploys — edit one, forget the other, and the cluster registers the stale one.
function listFiles(dir) {
  try {
    return readdirSync(dir).filter(f => statSync(join(dir, f)).isFile()).sort()
  } catch (err) {
    problems.push(`cannot read ${dir}: ${err.message}`)
    return []
  }
}

const source = listFiles(SOURCE).filter(f => f !== 'README.md')
const vendored = listFiles(VENDORED)

for (const f of source) {
  if (!vendored.includes(f)) {
    problems.push(`registration/${f} has no vendored copy under deploy/helm/fuzex/files/registration/`)
    continue
  }
  if (!readFileSync(join(SOURCE, f)).equals(readFileSync(join(VENDORED, f)))) {
    problems.push(`registration/${f} differs from the chart copy — the chart would deploy the stale one`)
  }
}
for (const f of vendored) {
  if (!source.includes(f)) {
    problems.push(`deploy/helm/fuzex/files/registration/${f} has no source in registration/ — it is unreachable and stale`)
  }
}

if (problems.length) {
  console.error('✘ FuzeX registration is incoherent:\n')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(
  `✔ FuzeX registration coherent — slug "${manifest.slug}", nav ${section}/${manifest.nav.order}, ${source.length} file(s) vendored in sync`
)
