---
name: branch-audit
description: >
  Audit branches against main: sync main in, diff the result, evaluate whether
  the unique content strengthens or contradicts existing policy, then act.
  Invoke when cleaning up accumulated branches in any Fuze repo.
---

# Branch Audit skill

## Goal

For each target branch: sync main into it, inspect what unique content remains,
evaluate its policy alignment, then take the correct action: open a PR, delete
the branch, or flag for human review.

## Algorithm

### 1. Merge main into the branch (local)

```bash
git fetch origin
git checkout -b <branch> origin/<branch>
git merge origin/main --no-edit 2>&1
```

If the merge exits non-zero, **abort** and record the branch as `conflict`:

```bash
git merge --abort
```

### 2. Inspect the post-merge diff

```bash
git diff origin/main HEAD
```

- **Empty diff** → the branch's content is already fully present in main.
  Verdict: **stale**.
- **Non-empty diff** → unique content survives. Proceed to step 3.

### 3. Policy alignment check (the critical step)

**"Additive" does not mean "safe."** A branch that only adds content can still:
- **Contradict** an existing policy section (e.g. a new rule that conflicts
  with a rule already in CLAUDE.baseline.md or a governance doc)
- **Weaken** an existing constraint (e.g. relaxing a "never" to a "prefer",
  or adding exceptions to a hard rule without explicit rationale)
- **Remove** content that was intentionally placed (branches often add *and*
  remove — always check both directions of the diff)
- **Create inconsistency** between related policy sections (e.g. a new
  standard in §4 that conflicts with enforcement described in §8)
- **Duplicate** with slight differences (two descriptions of the same policy
  that diverge in their details, leaving consuming repos uncertain which to
  follow)

**Ask for every changed file/section:**

1. Does this diff modify a constraint or policy already stated elsewhere?
   Read the target files in `main` first.
2. Does the new content contradict or soften that existing policy? If yes →
   **flag** the specific conflict; do not merge without resolving it.
3. Does the diff *remove* lines from main's content? If yes → is that removal
   intentional cleanup or a regression?
4. Would a developer reading both the new content and the existing policy know
   unambiguously which rule takes precedence?
5. Net assessment: does this change make the SDLC/AgenticDLC **stronger or
   weaker** for consuming repos?

Only if the answers are "no contradiction", "intentional removal if any", and
"net stronger" is the verdict **valuable**.

If the content is ambiguous or would confuse consuming repos: **conflict**.

### 4. Act on the verdict

| Verdict | Action |
|---------|--------|
| `stale` | Record branch for deletion. Do not push. |
| `valuable` | Push the updated branch, open a PR with a body that explicitly states: (a) what unique content it adds, (b) which existing policy sections it was checked against, (c) the net-improvement rationale. |
| `conflict` | Record the branch, conflicting files, the specific policy tension, and what resolution is needed. Do not push, do not delete. |

### 5. Report

Return a structured summary for every branch processed:

```json
{
  "branch": "feat/example",
  "verdict": "valuable|stale|conflict",
  "reason": "one-sentence explanation",
  "uniqueDiffSummary": "what the diff adds or removes vs main",
  "policyCheckSections": ["CLAUDE.baseline.md §4", "governance/versioning.md"],
  "contradictions": ["describes any policy conflicts found, or empty list"],
  "netAssessment": "strengthens|weakens|neutral",
  "conflictFiles": ["file1", "file2"],
  "prUrl": "https://github.com/.../pull/NNN or null",
  "deleted": false
}
```

## Decision heuristics

- **Release branches** (`chore/release-vX.Y.Z`): stale if the corresponding
  tag exists on main. Check with `git tag --list 'vX.Y.Z'`.
- **Squash-merged branches**: `git diff origin/main HEAD` empty after merging
  main in → always stale.
- **Branches that only remove content from main**: review extremely carefully.
  Removal is always intentional or a regression — never assume it is neutral.
- **Feature branches with open PRs**: do not touch. Sync via
  `update_pull_request_branch` API instead.
- **Claude session branches** (`claude/*`): treat like any other.
- **Conflict branches**: record all conflicting files and the policy tension.
  Never push partial merges. Hand off for human resolution.
- **Documentation-only branches**: apply the full policy check. A doc change
  that rewords an existing rule is not safe by default — it may soften "must"
  to "should", remove a "never", or rename a concept that other policy refers to.

## PR body template (for `valuable` branches)

```markdown
## What this branch adds

<one paragraph: the unique content, clearly stated>

## Policy sections reviewed

- <list each CLAUDE.baseline.md section or governance doc checked>

## No contradictions found

<explicit statement of what was checked and why there is no conflict>

## Net assessment: strengthens

<why this makes the SDLC/AgenticDLC better for consuming repos>
```

## Example invocation (Workflow agent prompt)

```
Using the branch-audit skill, audit branch 'feat/example' in izzywdev/FuzeSDLC.
Merge origin/main into it, diff the result, run the full policy alignment check
(step 3) against the relevant sections of CLAUDE.baseline.md and governance/,
classify the branch, and return the structured JSON report including
policyCheckSections, contradictions, and netAssessment.
```
