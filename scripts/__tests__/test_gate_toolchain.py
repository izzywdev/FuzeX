"""Tests for scripts/gate-toolchain.mjs, and especially for `--coherence-only`.

These assert that the gate **FAILS** on a violation, not only that it passes on a clean
tree. Passing is not evidence: this repo has been bitten by a check that was green solely
because its work was always done by someone else before it ran (`claude-auto-pr.yml` — every
green run was the early-exit path, and the one time it had work to do it failed). It has also
been bitten, twice, by a check that was green because it could not SEE the thing it was
supposed to look at:

  * `federationConfigs` scanned `*vite.config.ts` and `*webpack.config.js` only. FuzePlan —
    the repo whose incoherent config started all of this — declares its federation in
    `frontend/vite.config.JS`, so the gate reported "0 federation config(s) scanned" there.
  * the plugin marker matched `@originjs/vite-plugin-federation|ModuleFederationPlugin` only,
    so every repo on `@module-federation/vite` was skipped — fuzehub's four remotes, whose
    `shared` block lives in a separate `module-federation.config.ts` the old file-list did not
    even glob for.

Both blind spots have a test below that fails if either is narrowed again.

WHAT --coherence-only IS FOR. The floor checks in this gate are ABSOLUTE ("is this at least
^19?"), so they fire on any repo that is merely behind — which is most of the family — and
they run behind `|| true` and ratchet per repo. The coherence check is RELATIVE: it fires only
when two files in the SAME repo contradict each other, which no repo in the family does and
which only a half-applied write produces. That is why it gets its own harden-gate step with no
`|| true`, and why the tests below pin BOTH directions: a below-floor-but-coherent repo must
PASS (or the enforcing step would red pre-existing debt) and an incoherent repo must FAIL.

Run: python -m unittest discover -s scripts/__tests__ -p 'test_*.py'
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(REPO_ROOT, "scripts", "gate-toolchain.mjs")
NODE = shutil.which("node")

OBJECT_CFG = """
import {{ federation }} from '@originjs/vite-plugin-federation'
export default {{
  plugins: [
    federation({{
      name: 'r',
      shared: {{
        react: {{ singleton: true, requiredVersion: '{v}' }},
        'react-dom': {{ singleton: true, requiredVersion: '{v}' }},
      }},
    }}),
  ],
}}
"""

#: fuzehub's shape: `@module-federation/vite`, and the shared block lives in its own file.
MF_CONFIG = """
import {{ defineConfig }} from '@module-federation/vite'
export default defineConfig({{
  name: 'talent',
  shared: {{
    react: {{ singleton: true, requiredVersion: '{v}' }},
    'react-dom': {{ singleton: true, requiredVersion: '{v}' }},
  }},
}})
"""

BARE_ARRAY_CFG = """
import { federation } from '@originjs/vite-plugin-federation'
export default {
  plugins: [federation({ name: 'r', shared: ['react', 'react-dom'] })],
}
"""


def run_gate(root: str, *flags: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [NODE, GATE, *flags], cwd=root, capture_output=True, text=True, timeout=180)


class SyntheticRepo:
    """A throwaway git repo — the gate reads `git ls-files`, so it needs one."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def write(self, rel: str, content: str) -> None:
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path) or self.root, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content).lstrip("\n"))

    def package(self, rel: str, react: str | None, **extra) -> None:
        body: dict = {"name": os.path.dirname(rel) or "root", "version": "1.0.0"}
        if react is not None:
            body["dependencies"] = {"react": react, "react-dom": react}
        body.update(extra)
        self.write(rel, json.dumps(body, indent=2))

    def track(self) -> None:
        subprocess.run(["git", "-C", self.root, "add", "-A"], check=True,
                       capture_output=True)

    def __enter__(self) -> "SyntheticRepo":
        return self

    def __exit__(self, *exc) -> None:
        self._tmp.cleanup()


@unittest.skipUnless(NODE, "node is not on PATH")
class CoherenceTests(unittest.TestCase):
    """`--coherence-only`: the share scope versus the React the app actually ships."""

    def test_a_shared_scope_ahead_of_the_dependency_FAILS(self):
        # THE DEFECT. requiredVersion '^19.0.0' beside "react": "^18.2.0" is a requirement
        # Module Federation cannot satisfy. It type-checks, builds, passes unit tests, and
        # dies as "Invalid hook call" in a browser. Nothing else in CI looks at the pair.
        with SyntheticRepo() as repo:
            repo.write("frontend/vite.config.ts", OBJECT_CFG.format(v="^19.0.0"))
            repo.package("frontend/package.json", "^18.2.0")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertIn("frontend/vite.config.ts", res.stderr)
        self.assertIn("frontend/package.json", res.stderr)
        self.assertIn("Invalid hook", res.stderr)

    def test_a_shared_scope_BEHIND_the_dependency_also_FAILS(self):
        # The other direction is equally fatal and is the shape fuzehub's remotes were in:
        # requiredVersion '^18.3.1' while the package ships React 19. The remote refuses the
        # host's React and loads its own — same white screen, opposite arithmetic.
        with SyntheticRepo() as repo:
            repo.write("packages/x/module-federation.config.ts", MF_CONFIG.format(v="^18.3.1"))
            repo.package("packages/x/package.json", "^19.2.0")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertIn("packages/x/module-federation.config.ts", res.stderr)

    def test_a_repo_BELOW_the_floor_but_internally_coherent_PASSES(self):
        # THE HALF THAT MAKES THIS STEP SAFE TO ENFORCE. React 18 everywhere is debt, and
        # the report-only floor step is what reports it. If coherence failed here too, the
        # enforcing step would red every repo that is merely behind — which is the reason
        # the floor step has `|| true` in the first place — and it would be removed again.
        with SyntheticRepo() as repo:
            repo.write("frontend/vite.config.js", OBJECT_CFG.format(v="^18.0.0"))
            repo.package("frontend/package.json", "^18.2.0")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_a_repo_AT_the_floor_passes(self):
        with SyntheticRepo() as repo:
            repo.write("frontend/vite.config.ts", OBJECT_CFG.format(v="^19.0.0"))
            repo.package("frontend/package.json", "^19.2.0")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_a_repo_with_no_federation_config_passes_vacuously_and_SAYS_SO(self):
        # A vacuous pass is fine; a vacuous pass that reads like a real one is not. The
        # count in the success line is what distinguishes them, so it is asserted.
        with SyntheticRepo() as repo:
            repo.package("package.json", None)
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("0 federation config(s)", res.stdout)


@unittest.skipUnless(NODE, "node is not on PATH")
class BlindSpotTests(unittest.TestCase):
    """The two ways this gate reported a clean scan of files it never opened."""

    def test_a_dot_JS_vite_config_is_scanned(self):
        # FuzePlan. The file list was `*vite.config.ts` + `*webpack.config.js`, so the repo
        # that motivated this entire check reported "0 federation config(s) scanned".
        with SyntheticRepo() as repo:
            repo.write("frontend/vite.config.js", OBJECT_CFG.format(v="^19.0.0"))
            repo.package("frontend/package.json", "^18.2.0")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 1,
                         "a .js federation config must be scanned exactly like a .ts one")
        self.assertIn("frontend/vite.config.js", res.stderr)

    def test_the_module_federation_vite_plugin_is_recognised(self):
        # fuzehub. `@module-federation/vite` matched neither marker, so four remotes with a
        # real shared block were skipped and the gate reported a clean pass.
        with SyntheticRepo() as repo:
            repo.write("packages/x/module-federation.config.ts", MF_CONFIG.format(v="^19.0.0"))
            repo.package("packages/x/package.json", "^18.3.1")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)

    def test_the_NEAREST_package_json_governs_not_the_root(self):
        # A bundler resolves React from the nearest ancestor manifest. Comparing against the
        # repo root instead would clear a broken remote whenever the root happened to be on
        # the floor — a false pass in the exact monorepo layout most of the family uses.
        with SyntheticRepo() as repo:
            repo.package("package.json", "^19.2.0")
            repo.write("apps/web/vite.config.ts", OBJECT_CFG.format(v="^19.0.0"))
            repo.package("apps/web/package.json", "^18.2.0")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
        self.assertIn("apps/web/package.json", res.stderr)

    def test_a_loose_react_range_is_still_compared(self):
        # `"react": ">=18"` has no x.y.z, so the gate's minMajor() returns null for it. If
        # the coherence check used minMajor directly it would skip this manifest silently —
        # and `>=18` beside requiredVersion '^19.0.0' is exactly the shape it exists to
        # catch. fuzesales shipped `"react": ">=18"`.
        with SyntheticRepo() as repo:
            repo.write("p/vite.config.ts", OBJECT_CFG.format(v="^19.0.0"))
            repo.package("p/package.json", ">=18")
            repo.track()
            res = run_gate(repo.root, "--coherence-only")
        self.assertEqual(res.returncode, 1, res.stdout + res.stderr)

    def test_a_bare_array_is_a_FLOOR_violation_not_a_coherence_one(self):
        # `shared: ['react']` declares no requiredVersion at all, so there is no version to
        # contradict the dependency. The full gate rejects it structurally; the enforcing
        # coherence step must not, or it would red the four repos on that shape for a
        # finding the report-only step already owns.
        with SyntheticRepo() as repo:
            repo.write("frontend/vite.config.ts", BARE_ARRAY_CFG)
            repo.package("frontend/package.json", "^18.2.0")
            repo.track()
            coh = run_gate(repo.root, "--coherence-only")
            full = run_gate(repo.root)
        self.assertEqual(coh.returncode, 0, coh.stdout + coh.stderr)
        self.assertEqual(full.returncode, 1)
        self.assertIn("bare-array", full.stderr)


@unittest.skipUnless(NODE, "node is not on PATH")
class FullGateTests(unittest.TestCase):
    def test_the_full_gate_also_reports_coherence(self):
        # --coherence-only must be a FILTER on the output, not the only place the check
        # runs. If it were the only place, a repo that removed its `|| true` from the floor
        # step would stop enforcing coherence rather than start.
        with SyntheticRepo() as repo:
            repo.write(".nvmrc", "24\n")
            repo.write("frontend/vite.config.ts", OBJECT_CFG.format(v="^19.0.0"))
            repo.package("frontend/package.json", "^18.2.0",
                         engines={"node": ">=24.0.0", "npm": ">=10.0.0"})
            repo.track()
            res = run_gate(repo.root)
        self.assertEqual(res.returncode, 1)
        self.assertIn("cannot satisfy", res.stderr)

    def test_the_flag_this_gate_is_invoked_with_actually_exists(self):
        # harden-gate.yml greps the vendored script for this literal before running the
        # enforcing step, and skips with a warning when it is absent. Rename the flag and
        # every repo silently downgrades to that warning — a green step doing nothing, which
        # is the failure mode this whole change exists to remove.
        with open(GATE, encoding="utf-8") as f:
            self.assertIn("--coherence-only", f.read())


if __name__ == "__main__":
    unittest.main()
