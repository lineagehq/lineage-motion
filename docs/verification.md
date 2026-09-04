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
the broad public graph in parallel. This makes integration failures visible
during implementation instead of postponing them until packaging is complete.

Before sharing work, run `npm run verify:fast`. Mark the pull request ready
only when the bounded implementation and its focused verification are
complete. Do not merge until every required check passes on the exact head
commit. `main` requires a pull request, an up-to-date branch, resolved review
conversations, and these checks:

- `policy-fast`
- `integration`
- `recovery-parity`
- `determinism-visual`
- `browser`
- `typecheck-build`
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

- Pre-commit runs the line limit and verification-manifest checks.
- Pre-push runs the complete fast tier.

Git's standard `--no-verify` option can bypass a local hook for emergency
work. It does not bypass CI: the pull-request workflow reruns the file policy,
manifest policy, and every public verification leaf.

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
verification manifest. Then run:

```sh
npm run check:verification-manifest
npm run check:line-limit
npm run verify:fast
```

The manifest check rejects both unowned tests and tests listed in multiple
leaves. Add a new leaf only when its runtime boundary or setup is genuinely
different; otherwise extend the existing owner.
