# Verification workflow

Verification has one manifest, three normal tiers, and focused leaf suites.
The manifest in `scripts/repository-policy/verification-manifest.mjs` owns
every tracked test exactly once. Package aliases, local hooks, and CI select
those same owners instead of maintaining separate path lists.

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

Before sharing work, run `npm run verify:fast`. Before merging, run
`npm run verify:pr`. The local runner is serial so a failure is easy to
attribute; CI fans the same public suite identifiers across independent jobs.

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
