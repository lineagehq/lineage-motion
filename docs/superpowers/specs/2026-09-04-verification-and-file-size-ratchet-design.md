# Verification and File-Size Ratchet Design

## Decision

Replace the current overlapping verification scripts with one repository-owned
suite manifest and DAG runner. Add a hard 500-line limit for hand-authored code,
tests, scripts, styles, and configuration. The same policy must run in the local
fast tier, repository-managed pre-commit and pre-push hooks, and GitHub Actions.

This work changes verification and code organization only. It must preserve the
motion document, importer, compiler, service, editor, CLI, preview, export, and
receipt behavior already accepted on `origin/main`.

## Goals

1. Keep test discovery inside the active worktree and explicitly exclude
   `.worktrees`, dependencies, build output, coverage, caches, and generated
   artifacts.
2. Provide a genuinely fast local tier without browsers, subprocess recovery,
   visual proof, private corpus access, or installed-Chrome workflows.
3. Assign every automated test to one primary suite and reject missing or
   overlapping assignments.
4. Execute aggregate verification as a DAG whose leaf suites never invoke one
   another.
5. Reject every in-scope tracked file over 500 physical lines locally, before
   push, and in CI.
6. Refactor every current in-scope violation below the limit without changing
   public behavior or exported APIs.

## Non-goals

- Do not change product behavior or add Phase 5 functionality.
- Do not change private-corpus semantics or commit private artifacts.
- Do not make private acceptance data available to GitHub Actions.
- Do not add persistence, Lineage integration, publication, or release work.
- Do not use arbitrary line chopping, generated minification, or compressed
  formatting to satisfy the limit.
- Do not require the complete browser/visual/private matrix on every local
  push.

## File-limit scope

The limit is exactly 500 physical lines. A 500-line file passes; a 501-line
file fails. Blank and comment lines count because both still contribute to the
amount of material a person or agent must inspect.

The gate covers tracked hand-authored files in these surfaces:

- `apps/**` source, tests, scripts, CSS, and HTML;
- `packages/**` source and tests;
- `scripts/**` JavaScript and TypeScript;
- root JavaScript, TypeScript, and tool configuration files; and
- `.github/**` executable scripts or configuration where line counting is
  meaningful.

The gate exempts:

- `package-lock.json` and other machine-generated dependency locks;
- binary assets;
- `docs/**`, including prose, evidence receipts, GoalBuddy state, generated
  goal-board surfaces, and design references;
- `fixtures/**`, which are data rather than executable implementation; and
- ignored or untracked files.

Exemptions are path- and purpose-based, live in one policy module, and are
covered by tests. The checker reads the tracked inventory from Git so an ignored
sibling worktree cannot enter the scan.

## Repository policy boundary

Create a small policy package under `scripts/repository-policy/`:

- `tracked-files.mjs` obtains and normalizes the Git-tracked inventory.
- `line-limit.mjs` classifies paths, detects binary content, counts physical
  lines, and returns structured violations.
- `verification-manifest.mjs` declares leaf suites, their owned tests, and DAG
  tiers.
- `verification-policy.mjs` validates that every discovered test belongs to
  exactly one primary suite and that aggregate nodes contain only suite names.
- `run-verification.mjs` executes requested DAG nodes, records duration and exit
  status, and stops dependent work after a failure.
- focused tests execute these modules against temporary synthetic repositories
  and literal manifests.

Commands return concise human output by default and deterministic JSON with a
flag for CI receipts. Failure output names the exact files, line counts, suite
ownership conflicts, or missing assignments.

## Verification taxonomy

Every test file has one primary owner. Aggregate tiers reference owners rather
than duplicating file paths.

### Fast

Pure Node tests only: domain transformations, canonicalization, importer
parsing/materialization without browser acquisition, compiler formatting,
preview projections without a browser, review-domain logic, protocol parsing,
and repository policy tests.

The fast tier must not launch Chrome, start a service, create SQLite stores,
spawn child processes, inspect private inputs, or rasterize frames. Its runtime
is measured during acceptance with a target below ten seconds, but a wall-clock
assertion is not committed because shared-machine load would make it flaky.

### Public integration

Distinct leaf suites own:

- service transactions;
- process recovery and branch/claim fault injection;
- editor/CLI parity and public aggregate proof;
- browser acquisition and five-scene public boundary proof;
- compiler determinism;
- public visual proof;
- Playwright editor/browser behavior;
- installed-Chrome QA;
- typecheck and production build; and
- privacy, private-ignore, diff, and file-limit policy checks.

### Private acceptance

Private import, private visual proof, receipt verification, and source-bound
five-scene checks remain explicit full-tier leaves. They are available locally
when authorized inputs exist and are not run in public CI.

## DAG and commands

Leaf commands execute tests directly and never call another aggregate command.
The manifest defines three aggregates:

- `verify:fast`: file policy, manifest policy, and fast tests.
- `verify:pr`: all public leaf suites, with independent suites eligible for
  parallel CI jobs.
- `verify:full`: the public DAG plus installed-Chrome and authorized private
  acceptance leaves.

Existing useful leaf command names remain as compatibility aliases where they
do not imply nested execution. `verify:phase3` becomes a DAG selection, not a
shell chain. `qa:chrome` owns only installed-Chrome scenarios and no longer
invokes Playwright. `test:unit` aliases the fast test owner and cannot discover
service, recovery, parity, visual, private, or browser tests.

The runner detects dependency cycles and unknown nodes before executing work.
Local execution is serial by default for readable failure isolation. GitHub
Actions fans independent nodes into separate jobs.

## Local commit and push enforcement

Use Husky with committed `.husky/pre-commit` and `.husky/pre-push` hooks.
Dependency setup initializes Husky through the `prepare` lifecycle without a
repository-specific installer.

The pre-commit hook executes the near-instant repository policy checks:

- `npm run check:line-limit`; and
- `npm run check:verification-manifest`.

The pre-push hook executes `npm run verify:fast` and refuses the push on file
policy, suite-manifest, or fast-test failure. Browser, visual, recovery,
installed-Chrome, and private suites do not run in either local hook.

Hooks print direct recovery commands and honor Git's standard `--no-verify`
bypass. CI remains authoritative, so bypassing a hook cannot merge an oversized
file or broken policy.

Worktree handling must be explicit: hook tests must prove that commands execute
from the worktree being committed or pushed. No hook or package script may
hard-code an absolute checkout path.

## GitHub Actions

Add a public verification workflow for pull requests and pushes to `main`.

The first job runs repository policy and fast tests. Downstream jobs run the
public integration, recovery/parity, deterministic/visual, and browser groups
from the manifest. Typecheck and build run in the public graph. Jobs use
`npm ci`, a pinned supported Node version, dependency caching, and concurrency
cancellation for superseded commits.

The file-limit check is therefore visible as part of the policy job and blocks
the workflow immediately. Branch protection must later mark the public policy
and verification jobs required; the committed workflow itself cannot configure
repository protection.

Installed Google Chrome checks may run in public CI only where their existing
contract is portable and deterministic. Private acceptance never runs without
an explicit secure environment and is not required by this change.

## Refactoring strategy

The initial failing line-limit test provides the red phase for every oversized
implementation file. Existing focused behavioral tests protect observable
behavior while modules move. Public barrel modules preserve current import
paths.

Responsibilities will be extracted as follows:

- `apps/editor/src/main.ts`: bootstrap/wiring, durable publication and
  reconciliation, preview controls, reusable-cue workspace, shot workspace,
  and DOM/form utilities.
- `apps/editor/scripts/qa-chrome.mjs`: CLI entry, shared browser/server harness,
  canvas-first scenario, spatial-parity scenario, private-workspace smoke, and
  diagnostics.
- `packages/domain/src/index.ts`: document model/schema, validation,
  canonicalization, timeline projection, structural authoring, and shared
  domain utilities.
- `packages/css-import/src/index.ts`: inventory, CSS parsing, source binding,
  animation/keyframe materialization, and diagnostics.
- `packages/browser-resolved-preprocessor/src/acquisition.ts`: acquisition
  model, lock/resource validation, browser serialization route, and result
  validation.
- `packages/local-service/src/sqlite-project-store.ts`: transaction helpers,
  motion execution, branch/claim control, review/handoff storage, and reads.
- `packages/motion-protocol/src/index.ts`: operation schemas, response/read
  schemas, parsing, command builders, and service client.
- `packages/css-compiler/src/index.ts`: compilation, warped-keyframe handling,
  safety inspection, and formatting/digest helpers.
- `apps/editor/src/styles.css`: foundations, timeline/editor controls, shot
  workspace, cue workspace, and responsive rules.
- oversized tests: shared harnesses/fixtures plus behavior-focused spec files;
  no assertion may be deleted merely to satisfy the limit.

Each original `index.ts` remains a small compatibility barrel. Cyclic imports
are rejected by typecheck/build and targeted test execution. Extracted modules
must remain below 500 lines individually and must represent a coherent
responsibility rather than numbered fragments.

## TDD and execution order

1. Add repository-policy behavior tests and observe them fail because current
   oversized files are accepted and suite ownership is undefined.
2. Implement tracked-file isolation, the line gate, and manifest validation.
3. Add failing discovery tests proving `.worktrees` and non-fast suites cannot
   enter the fast tier; then implement the explicit Vitest configuration.
4. Add DAG behavior tests for unknown nodes, cycles, duplicate leaves,
   dependency failure, and deterministic receipts; then implement the runner.
5. Wire package commands, both Husky hooks, and CI to the same manifest.
6. Refactor one oversized production boundary at a time, running its focused
   existing tests and the line gate after each extraction.
7. Split oversized tests and styles without weakening behavior or selectors.
8. Run one fresh complete public DAG, installed-Chrome QA, authorized private
   checks where inputs exist, sensitive-content inspection, and final diff
   review.

## Acceptance criteria

- No in-scope tracked file exceeds 500 physical lines.
- A synthetic 500-line file passes and a 501-line file fails with its path and
  count.
- Running from the main checkout or any linked worktree cannot discover tests
  from sibling `.worktrees`.
- Every tracked automated test has exactly one primary suite owner.
- `test:unit`/`verify:fast` launch no browser, service, SQLite store, recovery
  subprocess, visual proof, or private acceptance workflow.
- Aggregate DAG nodes execute every selected leaf at most once.
- `qa:chrome` does not invoke Playwright.
- Husky installs through `prepare` without an absolute checkout path.
- The committed pre-commit hook runs line-limit and manifest policy checks.
- The committed pre-push hook runs the fast policy gate.
- GitHub Actions runs the same file policy and public verification manifest.
- Existing public APIs and import paths remain compatible.
- All public behavioral, browser, visual, deterministic, typecheck, build,
  privacy, and repository-safety checks pass.
- Private files, paths, screenshots, databases, and corpus content remain
  untracked and absent from the diff.

## Adversarial failure modes

1. **The ratchet appears green while skipping files or tests.** Direct evidence
   must compare Git-tracked inventory with policy classification and prove
   exactly-one suite ownership.
2. **Refactoring changes behavior or creates a second implementation path.**
   Existing domain, service, CLI, compiler, browser, visual, and deterministic
   receipts must remain green through the preserved public entry points.
3. **Faster feedback is achieved by silently weakening proof.** Test counts and
   suite assignments must show that slow tests moved to explicit leaves rather
   than disappearing; the final public/full DAG must execute each required
   leaf once.
