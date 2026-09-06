# Verification workflow

Verification has one manifest, three normal tiers, and focused leaf suites.
The manifest in `scripts/repository-policy/verification-manifest.mjs` owns
every tracked test exactly once. Package aliases, local hooks, and CI select
those same owners instead of maintaining separate path lists.

`docs/agent-workflow.md` defines who runs each tier. A green result belongs to
the tested commit and should be reused across agent or reviewer handoffs.

## Daily development loop

Use `npm run test:unit` while editing ordinary domain, compiler, protocol, or
preview code. It is intentionally isolated from service processes, recovery,
SQLite, visual proof, browsers, installed Chrome, and private acceptance.

Use a focused leaf when the change crosses one of those boundaries:

```sh
node scripts/run-verification.mjs --suite service-integration
node scripts/run-verification.mjs --suite recovery
node scripts/run-verification.mjs --suite parity
node scripts/run-verification.mjs --suite browser
```

After the first coherent implementation commit, push the feature branch and
open a draft pull request. Keep using focused local suites while GitHub runs
the draft smoke graph in parallel. Every code update receives fast tests,
type checking, a production build, determinism, and normal-launch UI/CLI proof.
Ready PRs receive the complete public graph on every subsequent head change.

Pre-push verifies the actual tips supplied by Git: the fast tier, types, build,
determinism, and conservatively selected service/parity tests. See
[local hooks](local-hooks.md) for exact-state isolation and timing evidence.
Reuse current hook results rather than repeating them manually. Mark the pull
request ready
only when the bounded implementation and its focused verification are
complete. Do not merge until every required check passes on the exact head
commit. `main` requires a pull request, an up-to-date branch, resolved review
conversations, and these checks:

- `verification-gate`
- `Analyze (javascript-typescript)`

The local runner remains available as `npm run verify:pr` when a complete
serial reproduction is useful. It is not a handoff ritual: do not run it when
CI already proves the same exact revision, and do not ask each agent or reviewer
to reproduce another participant's current evidence.

## File-size ratchet

`npm run check:line-limit` examines tracked hand-authored code, tests,
scripts, styles, and configuration. A file with exactly 500 physical lines is
allowed; 501 is rejected. Documentation, evidence, fixtures, generated locks,
and binary artifacts are outside this maintainability policy.

The check uses Git's tracked inventory for the active checkout. It does not
walk sibling worktrees, dependency directories, build output, or untracked
private material.

## Hooks

`npm install` and `npm ci` activate committed Husky hooks through the
`prepare` lifecycle.

- Pre-commit checks staged blobs for privacy, forbidden artifacts, file size
  and manifest ownership without changing unstaged work.
- Pre-push creates isolated snapshots of actual pushed tips and checks the
  selected verification leaves. Deletion-only pushes have no tip to test.

Git's standard `--no-verify` option can bypass a local hook for emergency
work. It does not bypass CI: the pull-request workflow reruns the file policy,
manifest policy, and the graph required by the PR state. Ready PRs run every
public verification leaf.

## Public, Chrome, and private tiers

- `npm run verify:fast`: repository policies and isolated fast tests.
- `npm run verify:pr`: every public CI leaf exactly once.
- `npm run qa:chrome`: installed-Chrome QA only; it does not invoke
  Playwright.
- `npm run verify:phase3`: public verification plus installed-Chrome QA,
  with no nested aggregate commands.
- `npm run verify:full`: the public graph, installed Chrome, and authorized
  private acceptance.

Public CI never selects private import, visual, receipt, or corpus-bound tests.

## Adding or moving a test

Add the tracked test path to exactly one leaf's `files` array in the
verification manifest. Run the affected leaf while editing. Pre-commit owns
staged policies; pre-push owns exact-tip verification. Run an individual
policy check locally when diagnosing its failure or checking a manifest edit
before committing, and reuse current hook evidence.

The manifest check rejects both unowned tests and tests listed in multiple
leaves. Add a new leaf only when its runtime boundary or setup is genuinely
different; otherwise extend the existing owner.

## CI selection and aggregate gate

`scripts/ci-verification.mjs` reads the current PR head and readiness through
the read-only GitHub API at both planning and aggregation. Stale heads,
unavailable state, and a changed plan fail closed. Rerunning a draft-era event
after readiness therefore selects full proof; becoming ready during a smoke
run prevents that lightweight gate from succeeding. Cancellation groups include
head and event state so an old draft run cannot cancel the ready run. GitHub
[preserves the original event when rerunning a workflow](https://github.blog/changelog/2019-09-30-github-actions-deterministic-re-runs-for-workflows/),
so the original event alone is insufficient evidence of readiness.

The planner classifies the complete merge-base-to-head diff,
including both sides of renames. Unknown or malformed evidence fails closed.
Only README/LICENSE and ordinary Markdown under docs qualify as prose;
executable docs, instructions, fixtures, dependency locks and configuration
remain code changes. Prose changes run repository and privacy policies.

Draft code PRs run the smoke graph. Opening, reopening, editing or synchronizing
a ready code PR runs the broad public graph; ready-for-review triggers it too.
Nightly and manual runs always select the broad public graph. Redundant main
push runs are removed; final delivery explicitly dispatches regression on the
resulting main commit. CodeQL retains its existing configuration.

The aggregate always runs. Draft code uses the distinct `draft-smoke-gate`
check name, which cannot satisfy the required `verification-gate` context. This
also protects the interval between checking readiness and publishing a result.
The required context is intentionally absent on a new draft code head until
ready proof runs. Prose and full runs publish `verification-gate`.

The aggregate requires success from every selected
job, with explicit skipped status only for unselected jobs. Missing planning
output, failed, canceled or unexpectedly skipped jobs cannot turn green.
`browser-smoke` owns the normal startup and managed-app/real-CLI smoke tests; the broad
browser leaf excludes them, so each ready-PR test is executed once.

Required-context migration was validated on 2026-09-06 in [PR #26](https://github.com/lineagehq/lineage-motion/pull/26).
The [ready run](https://github.com/lineagehq/lineage-motion/actions/runs/34063209679)
and [rerun of the original draft event, attempt 4](https://github.com/lineagehq/lineage-motion/actions/runs/34062895481/attempts/4)
both selected and passed full verification at `e35ccaee`.
An [intentional failed prerequisite](https://github.com/lineagehq/lineage-motion/actions/runs/34063568095)
at temporary probe commit `c6e2449` failed the aggregate even with the other jobs
skipped; GitHub reported the ready PR as blocked. The probe is removed before
merge. The migration replaced only the six verification contexts with
`verification-gate`, retaining CodeQL, strict up-to-date checking, PR enforcement,
conversation resolution, admin enforcement and force-push/deletion protections.
All other protection fields matched the saved before/after snapshots.

Three actual draft smoke runs at `e35ccaee` took **63, 76 and 56 seconds**
including job setup. Initial workflow-to-first-runner delays were **4, 5 and
4 seconds**, respectively; these are separate from smoke execution and do not
claim to measure every dependency queue. These are attempts 1–3 of the draft
run linked above.

On the audit Mac, five warm exact-tip push measurements with the new policies
were 12.463, 13.934, 12.940, 12.678 and 12.980 seconds: median **12.940s**, maximum
**13.934s**. Five commit-policy measurements had median **0.104s**, maximum
**0.123s**. An earlier heavily loaded series reached median **24.547s**, maximum
**25.490s**, despite passing all checks; the budgets are measured iteration
conditions, not guarantees under arbitrary host contention. Dependency setup
remains inside push measurements; the original cold setup receipt is in
[local hooks](local-hooks.md).

Failure uploads contain only sanitized server diagnostics. Do not upload raw
browser traces, session files or databases; they can carry live capabilities.
