#!/usr/bin/env node
// gate-toolchain: enforces the family's Node 24 / React 19 toolchain floor
// (originated in FuzeFront's CLAUDE.md "Toolchain baseline" table — FuzeFront
// is the Module-Federation host, so its React major is the shared-dependency
// contract for every remote in the family). Nothing enforced this before —
// the table "survived on review alone", and a sweep of sibling repos found
// Dockerfiles on node:18/20-alpine that no CI job had ever looked at.
//
// Safe to run on any repo: it scans package.json/.nvmrc/Dockerfiles/
// workflows/Module-Federation configs and passes vacuously (0 files scanned)
// on a repo with none of those — e.g. a non-Node repo, or a Node repo with no
// React/MF surface. Checks:
//   - .nvmrc == 24
//   - engines.node >=24.0.0 / engines.npm >=10.0.0 in every package.json
//   - @types/node ^24.13.3 in every TypeScript package.json (has a
//     "typescript" devDependency or any other @types/* dependency)
//   - react/react-dom app `dependencies` >=19.2.0
//   - @types/react / @types/react-dom >=19.2.0 where declared
//   - peerDependencies react/react-dom >=19.0.0 (and does not admit 18) where
//     a package already declares a React peer
//   - Module-Federation `shared.react(-dom)` — every federation config found
//     must use the explicit object form (the bare-array shorthand is rejected:
//     it carries no requiredVersion at all), must read requiredVersion
//     '^19.0.0', AND the host
//     (frontend/vite.config.ts) must match every remote found in-repo. A
//     silent mismatch here is the dangerous half of this gate: the remote
//     loads its own React copy and dies on "Invalid hook call" at runtime,
//     in the browser, with nothing else in CI to catch it.
//   - FROM node: base image major in every Dockerfile
//   - node-version: in every GitHub Actions workflow
//   - COHERENCE (--coherence-only): every federation config's shared
//     requiredVersion major must equal the React major its GOVERNING
//     package.json actually ships. This is the one check here that is not a
//     floor check, and the distinction matters: a repo below the floor is
//     debt, ratcheted per repo behind `|| true`, but a repo whose vite.config
//     demands React 19 from the share scope while its package.json ships 18
//     has a requirement it cannot satisfy no matter what the floor says. It
//     builds, type-checks and passes tests, and fails only in a browser as
//     "Invalid hook call". It is also never pre-existing debt — only a
//     half-applied write produces it — so it is enforced from day one, in its
//     own step with no `|| true`. Measured at the time this shipped: 0 of 19
//     federation configs across the family violate it.
//
// Deliberately excluded (frozen historical records, not governance):
//   docs/superpowers/plans/**, sdd/**, docs/chats/**
//
// Dependency-free. Run from the repo root: `node scripts/gate-toolchain.mjs`.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

const root = process.cwd()
const violations = []
//: Internal inconsistency, kept separate from `violations` so it can be reported and
//: exited on independently — see the COHERENCE note in the header.
const coherence = []
const coherenceOnly = process.argv.includes('--coherence-only')

const EXCLUDED_DIR_RE = /^(docs\/superpowers\/plans|sdd|docs\/chats)\//

function trackedFiles(pattern) {
  return execFileSync('git', ['ls-files', pattern], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => !/(^|\/)node_modules\//.test(f) && !/(^|\/)dist\//.test(f))
    .filter((f) => !EXCLUDED_DIR_RE.test(f))
}

function readText(file) {
  return readFileSync(`${root}/${file}`, 'utf8')
}

function readJson(file) {
  try {
    return JSON.parse(readText(file))
  } catch {
    return null
  }
}

// Extracts the leading major version number from a semver-ish range string,
// e.g. "^24.13.3" -> 24, ">=24.0.0" -> 24, "^18.0.0 || ^19.0.0" -> 18 (the
// LOWEST admitted major — that's the one that matters for "does this still
// admit an old major").
function admittedMajors(range) {
  return [...String(range).matchAll(/(\d+)\.\d+\.\d+/g)].map((m) => Number(m[1]))
}

function minMajor(range) {
  const majors = admittedMajors(range)
  return majors.length ? Math.min(...majors) : null
}

// Like minMajor, but falls back to the first integer in the string for ranges
// that are not full x.y.z — `>=18`, `18.x`, `18`. The floor checks above can
// afford to ignore those (a range with no parseable version is reported as
// missing anyway); the coherence check cannot, because `react: ">=18"` beside
// `requiredVersion: '^19.0.0'` is exactly the shape it exists to catch and
// minMajor alone returns null for it and silently passes.
function lowestMajor(range) {
  const m = minMajor(range)
  if (m !== null) return m
  const loose = String(range ?? '').match(/(\d+)/)
  return loose ? Number(loose[1]) : null
}

// The package.json a federation config actually ships React from: the nearest
// ancestor directory that has one, which is how the bundler resolves it —
// frontend/vite.config.ts is governed by frontend/package.json, not the root's.
// Same rule as the installer's caps/mf_remote._governing_package, deliberately,
// so the gate and the installer cannot disagree about which manifest counts.
function governingPackage(file) {
  let d = dirname(file)
  for (;;) {
    const cand = d === '.' || d === '' ? 'package.json' : `${d}/package.json`
    if (pkgFiles.includes(cand)) return cand
    if (d === '.' || d === '') return null
    d = dirname(d)
  }
}

// ── package.json: engines, @types/node, react/react-dom, @types/react(-dom), peerDependencies ──
const pkgFiles = trackedFiles('*package.json')

// ── .nvmrc ───────────────────────────────────────────────────────────────────
// GATED ON THE REPO ACTUALLY BEING A NODE REPO. This block used to demand .nvmrc
// unconditionally, which contradicted the header's own promise that the gate
// "passes vacuously (0 files scanned) on a repo with none of those — e.g. a non-Node
// repo". It did not: FuzeSDLC and FuzeInfra are Python-only and would have carried a
// permanent, unfixable-by-design violation demanding a Node version file for code
// that does not exist. A gate that cannot be satisfied is a gate that gets `|| true`
// bolted on and then protects nothing, which is the failure this whole sweep removes.
//
// "Is this a Node repo" is exactly "does it have a package.json outside node_modules"
// — the same rule the bootstrap installer uses to decide whether to seed .nvmrc at
// all. Counting .py files is the wrong detector in the other direction: nine repos in
// the family carry an incidental Python script and are unambiguously Node projects.
if (pkgFiles.length > 0) {
  let nvmrc
  try {
    nvmrc = readText('.nvmrc').trim()
  } catch {
    violations.push('.nvmrc is missing at the repo root (expected "24")')
    nvmrc = null
  }
  if (nvmrc !== null && nvmrc !== '24') {
    violations.push(`.nvmrc is "${nvmrc}", expected "24"`)
  }
}

for (const f of pkgFiles) {
  const p = readJson(f)
  if (!p) continue

  const engNode = p.engines?.node
  if (!engNode) {
    violations.push(`${f}: missing engines.node (expected ">=24.0.0")`)
  } else if ((minMajor(engNode) ?? 0) < 24) {
    violations.push(`${f}: engines.node "${engNode}" admits a Node major below 24`)
  }
  const engNpm = p.engines?.npm
  if (!engNpm) {
    violations.push(`${f}: missing engines.npm (expected ">=10.0.0")`)
  } else if ((minMajor(engNpm) ?? 0) < 10) {
    violations.push(`${f}: engines.npm "${engNpm}" admits an npm major below 10`)
  }

  const dev = p.devDependencies ?? {}
  const isTypeScriptPackage =
    'typescript' in dev || Object.keys(dev).some((k) => k.startsWith('@types/'))
  if (isTypeScriptPackage) {
    const typesNode = dev['@types/node']
    if (!typesNode) {
      violations.push(`${f}: TypeScript package missing devDependencies["@types/node"] (expected "^24.13.3")`)
    } else if ((minMajor(typesNode) ?? 0) < 24) {
      violations.push(`${f}: @types/node "${typesNode}" admits a major below 24`)
    }

    for (const typesPkg of ['@types/react', '@types/react-dom']) {
      const spec = dev[typesPkg]
      if (!spec) continue // not every TS package uses React types — only check when declared
      const major = minMajor(spec)
      if (major === null || major < 19 || (major === 19 && !/19\.[2-9]/.test(spec))) {
        violations.push(`${f}: ${typesPkg} "${spec}" is below the ^19.2.0 floor`)
      }
    }
  }

  const deps = p.dependencies ?? {}
  for (const reactPkg of ['react', 'react-dom']) {
    const spec = deps[reactPkg]
    if (!spec) continue
    const major = minMajor(spec)
    if (major === null || major < 19 || (major === 19 && !/19\.[2-9]/.test(spec))) {
      violations.push(`${f}: dependencies["${reactPkg}"] "${spec}" is below the ^19.2.0 floor`)
    }
  }

  const peer = p.peerDependencies ?? {}
  for (const reactPkg of ['react', 'react-dom']) {
    const spec = peer[reactPkg]
    if (!spec) continue // only packages that already declare a React peer are checked
    if ((minMajor(spec) ?? 99) < 19) {
      violations.push(
        `${f}: peerDependencies["${reactPkg}"] "${spec}" still admits a pre-19 React major — published @fuzefront/* packages must require ^19.0.0`
      )
    }
  }
}

// ── Dockerfiles ──────────────────────────────────────────────────────────────
const dockerFiles = trackedFiles('*Dockerfile*').filter((f) => !/\.dockerignore$/.test(f))
for (const f of dockerFiles) {
  let text
  try {
    text = readText(f)
  } catch {
    continue
  }
  for (const m of text.matchAll(/^FROM\s+node:(\S+)/gim)) {
    const tag = m[1]
    const majorMatch = tag.match(/^(\d+)/)
    const major = majorMatch ? Number(majorMatch[1]) : null
    if (major === null || major < 24) {
      violations.push(`${f}: FROM node:${tag} is below the node:24 floor`)
    }
  }
}

// ── GitHub Actions workflows: node-version ───────────────────────────────────
const workflowFiles = trackedFiles('.github/workflows/*.yml').concat(trackedFiles('.github/workflows/*.yaml'))
for (const f of workflowFiles) {
  let text
  try {
    text = readText(f)
  } catch {
    continue
  }
  for (const m of text.matchAll(/node-version:\s*['"]?(\d+)/g)) {
    const major = Number(m[1])
    if (major < 24) {
      violations.push(`${f}: node-version '${major}.x' is below the 24.x floor`)
    }
  }
}

// ── Module Federation shared.react(-dom).requiredVersion ────────────────────
// THE FILE LIST IS THE GATE'S BLAST RADIUS, and it was too small to see the repo
// this check was written for. It used to be `*vite.config.ts` + `*webpack.config.js`.
// FuzePlan — the repo whose incoherent config surfaced this whole defect — declares
// its federation in `frontend/vite.config.JS`, so the gate scanned 0 configs there and
// reported a clean pass. A gate that cannot see the known-bad case is not evidence.
//
// These names are kept in step with the installer's lib/detect.CONFIG_NAMES, which
// decides which files mf-remote will REWRITE. A file the installer can write and the
// gate cannot read is precisely how a half-applied config ships unnoticed.
const federationConfigs = [
  '*vite.config.ts', '*vite.config.js', '*vite.config.mjs', '*vite.config.mts',
  '*webpack.config.js', '*rsbuild.config.ts',
  // fuzehub's four remotes keep `shared` in a separate module-federation.config.*
  // imported by the vite config, so the shared block is in neither of the names above.
  '*module-federation.config.ts', '*module-federation.config.js',
].flatMap((g) => trackedFiles(g))
const foundRequiredVersions = [] // { file, react, reactDom }
for (const f of federationConfigs) {
  let text
  try {
    text = readText(f)
  } catch {
    continue
  }
  // MARKERS, kept identical to the installer's lib/detect.FEDERATION_MARKERS. This list
  // used to be `@originjs/vite-plugin-federation|ModuleFederationPlugin` only, which
  // silently excluded every repo on `@module-federation/vite` — fuzehub's four remotes,
  // whose module-federation.config.ts files require React ^18.3.1 from the share scope
  // while their package.json ships ^19.2.0. Four genuinely incoherent configs the gate
  // scanned past and reported as a clean 0-config pass.
  if (!/@originjs\/vite-plugin-federation|ModuleFederationPlugin|@module-federation|federation\(/.test(text)) continue
  if (!/shared\s*:/.test(text)) continue

  // The BARE-ARRAY shorthand — `shared: ['react', 'react-dom']` — requests no
  // singleton semantics at all, so version agreement is not even the question:
  // the remote can load its own React copy regardless of what any version
  // string says. It has to be caught STRUCTURALLY, because it presents as an
  // ABSENCE (no requiredVersion to compare) rather than as a wrong value — the
  // requiredVersion scan below finds nothing and would otherwise `continue`
  // past the file as "not part of this repo's MF contract". A check that skips
  // the configs most likely to be broken is worse than no check, because it
  // reports a clean scan.
  //
  // See FuzeFront#658 Group B: four sibling repos adopted this form after a
  // real constraint (never list `@fuzefront/*` in `shared` — it hits ENOTDIR on
  // source-aliased paths) was over-generalised into "shared must be a bare
  // array". The object form is compatible with that constraint; the host
  // proves it by using it.
  const bareArrayShared = text.match(/shared\s*:\s*\[([^\]]*)\]/)
  if (bareArrayShared && /['"]react(-dom)?['"]/.test(bareArrayShared[1])) {
    violations.push(
      `${f}: shared uses the bare-array shorthand (shared: [${bareArrayShared[1].trim()}]) — the array form ` +
        `carries NO requiredVersion, so nothing constrains which React this remote accepts from the share ` +
        `scope and it may fall back to its own copy, dying on "Invalid hook call" at runtime. ` +
        `Use the object form: { react: { requiredVersion: '^19.0.0' }, 'react-dom': { requiredVersion: '^19.0.0' } }`
    )
    continue
  }

  // Find requiredVersion for the react and react-dom entries specifically —
  // scan each shared-block entry's local text window rather than a single
  // global regex, since react and react-dom are separate keys.
  const reactMatch = text.match(/(['"]?)react\1\s*:\s*\{[^}]*requiredVersion:\s*['"]([^'"]+)['"]/)
  const reactDomMatch = text.match(/(['"]?)react-dom\1\s*:\s*\{[^}]*requiredVersion:\s*['"]([^'"]+)['"]/)
  if (!reactMatch && !reactDomMatch) continue // shared block doesn't cover react — not this repo's MF contract

  const react = reactMatch?.[2] ?? null
  const reactDom = reactDomMatch?.[2] ?? null
  foundRequiredVersions.push({ file: f, react, reactDom })

  for (const [label, spec] of [['react', react], ['react-dom', reactDom]]) {
    if (spec === null) {
      violations.push(`${f}: shared.${label} declared but has no requiredVersion`)
    } else if (spec !== '^19.0.0') {
      violations.push(`${f}: shared.${label}.requiredVersion is "${spec}", expected "^19.0.0"`)
    }
  }

  // NO `singleton: true` CHECK HERE, DELIBERATELY. An earlier draft of this file
  // required it, on the reasoning that requiredVersion alone does not force one
  // React instance. That reasoning is correct for WEBPACK Module Federation and
  // wrong for the plugin this family actually uses.
  //
  // `@originjs/vite-plugin-federation@1.4.1` does not support `singleton` at all.
  // Its own types/index.d.ts declares SharedConfig with the option COMMENTED OUT:
  //
  //     /** Allow only a single version of the shared module in share scope ... */
  //     // singleton?: boolean
  //
  // — alongside `eager`, `packageName` and `shareKey`, all likewise unsupported.
  // The live options are import, packagePath, requiredVersion, shareScope. And
  // `grep -rl singleton` over the whole installed package matches exactly one
  // file: that .d.ts comment. Nothing in dist/ reads it.
  //
  // The tell was visible in the host's own config all along: FuzeFront's
  // frontend/vite.config.ts writes `{ singleton: true, requiredVersion: ... } as any`,
  // and the `as any` is there precisely because TypeScript rejects the unknown
  // property. A cast silencing the compiler is a signal to check, not to copy.
  //
  // So requiring `singleton: true` would have made this gate enforce dead config
  // fleet-wide — a gate demanding a line that changes nothing, which is worse
  // than no gate because it manufactures false assurance. `requiredVersion`
  // agreement, checked above and across files below, is the real contract for
  // this plugin.
}
// ── COHERENCE: the shared scope vs the React the app actually ships ─────────
//
// THE DEFECT THIS CATCHES, and why nothing else here catches it. The floor checks
// above are ABSOLUTE — each asks "is this value at least ^19?" — so they fire on a
// repo that is merely behind, which is most of the family, which is why the whole
// job runs behind `|| true`. This check is RELATIVE: it fires only when two files
// in the same repo contradict each other. `requiredVersion: '^19.0.0'` in a
// vite.config beside `"react": "^18.2.0"` in the package.json that governs it is a
// requirement the app cannot satisfy at any floor. Module Federation's negotiation
// fails, the remote loads its own React copy, and the app dies on "Invalid hook
// call" — in a browser, at runtime, with a green build, green unit tests and a
// green type-check. There is no other static signal for it anywhere in CI.
//
// It is produced by exactly one thing: a half-applied write. The installer used to
// be that thing — mf-remote raised requiredVersion while node-toolchain skipped the
// dependency bump because a lockfile was committed, and the pair shipped this shape
// across a 20-repo rollout. Both halves were locally correct. Nothing looked at the
// pair. This does.
for (const { file, react, reactDom } of foundRequiredVersions) {
  const pkgFile = governingPackage(file)
  if (!pkgFile) continue // nothing governs it — no dependency to contradict
  const p = readJson(pkgFile)
  if (!p) continue
  const shipped = p.dependencies?.react ?? p.peerDependencies?.react ?? p.devDependencies?.react
  if (!shipped) continue // this package ships no React at all
  const shippedMajor = lowestMajor(shipped)
  if (shippedMajor === null) continue
  for (const [label, spec] of [['react', react], ['react-dom', reactDom]]) {
    if (!spec) continue
    const declaredMajor = lowestMajor(spec)
    if (declaredMajor === null) continue
    if (declaredMajor === shippedMajor) continue
    coherence.push(
      `${file}: shared.${label}.requiredVersion is "${spec}" (React ${declaredMajor}) but ` +
        `${pkgFile} ships "react": "${shipped}" (React ${shippedMajor}). The share scope ` +
        `declares a requirement this app cannot satisfy: Module Federation's version ` +
        `negotiation fails and the remote loads its own React copy, dying on "Invalid hook ` +
        `call" in the browser with nothing else in CI to catch it. Fix by moving BOTH — the ` +
        `dependency bump, the lockfile regeneration and the requiredVersion raise are one ` +
        `atomic unit. Do NOT lower requiredVersion to match an old dependency: that is a ` +
        `breaking change to every repo in the family (see governance/toolchain.json).`
    )
  }
}

if (foundRequiredVersions.length > 1) {
  const first = foundRequiredVersions[0]
  for (const other of foundRequiredVersions.slice(1)) {
    if (other.react !== first.react || other.reactDom !== first.reactDom) {
      violations.push(
        `Module-Federation requiredVersion MISMATCH: ${first.file} (react=${first.react}, react-dom=${first.reactDom}) ` +
          `!= ${other.file} (react=${other.react}, react-dom=${other.reactDom}) — a remote whose requiredVersion ` +
          `differs from the host silently loads its own React copy and dies on "Invalid hook call" at runtime`
      )
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
//
// COHERENCE-ONLY MODE reports and exits on `coherence` alone. It is a separate
// harden-gate step precisely so it can run WITHOUT `|| true` while the floor
// checks stay report-only: the two have different natures (see the header) and
// bolting them together would force one of them to be wrong. It is also why the
// flag is opt-in rather than the default — the full run must keep reporting
// everything, or removing a repo's `|| true` would stop enforcing coherence.
if (coherenceOnly) {
  if (coherence.length) {
    console.error(
      `\n✗ gate-toolchain --coherence-only FAILED — ${coherence.length} internally ` +
        `inconsistent Module-Federation config(s):\n`
    )
    for (const v of coherence) console.error('  - ' + v)
    console.error(
      '\nThis is NOT a "repo is behind the floor" finding, and it is not waived by the\n' +
        'per-repo floor ratchet. A shared-scope requirement the app cannot satisfy fails\n' +
        'only in a browser, at runtime, with everything else green.\n'
    )
    process.exit(1)
  }
  console.log(
    `✓ gate-toolchain coherence passed (${foundRequiredVersions.length} federation config(s) ` +
      `checked against their governing package.json).`
  )
  process.exit(0)
}

violations.push(...coherence)

if (violations.length) {
  console.error(`\n✗ gate-toolchain FAILED — ${violations.length} violation(s) of the Node 24 / React 19 floor:\n`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\nSee CLAUDE.md "Toolchain baseline" for the mandated floor. Raising it is fine;')
  console.error('lowering it is a breaking change to the family and must move the host, both')
  console.error('in-repo remotes, every published peer range, and every consumer together.\n')
  process.exit(1)
}

console.log(
  `✓ gate-toolchain passed (${pkgFiles.length} package.json, ${dockerFiles.length} Dockerfile(s), ` +
    `${workflowFiles.length} workflow(s), ${federationConfigs.length} federation config(s) scanned).`
)
