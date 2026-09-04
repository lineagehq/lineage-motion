# Verification and File-Size Ratchet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build isolated, non-overlapping verification tiers and refactor every hand-authored implementation/test file below a CI-enforced 500-line limit.

**Architecture:** A repository-policy package owns tracked-file classification, line counting, test-suite ownership, and DAG execution. Existing product entry points become compatibility barrels or composition roots while coherent responsibilities move to focused modules; existing behavioral suites remain the source of truth for product behavior.

**Tech Stack:** Node.js 22, TypeScript 5.9, Vitest 3, Playwright 1.62, Vite 7, Git hooks, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-verification-and-file-size-ratchet-design.md`

## Global Constraints

- Exactly 500 physical lines pass; 501 lines fail.
- Enforce the limit for tracked hand-authored code, tests, scripts, styles, and configuration.
- Exempt generated locks, binary assets, `docs/**`, `fixtures/**`, ignored files, and untracked files.
- Preserve every current public import path and user-visible behavior.
- Keep private corpus files, paths, screenshots, databases, and payload-bearing receipts untracked.
- Every automated test has exactly one primary suite owner.
- Leaf suites never call aggregate verification commands or other leaf suites.
- `verify:fast` starts no browser, service, SQLite store, recovery subprocess, visual proof, or private workflow.
- Run focused tests while extracting modules; run the complete public DAG only after convergence.

## Execution Order

Execute Tasks 1-4, then Tasks 6-9, then Tasks 5, 10, and 11. Husky is
deliberately installed only after every current oversized file has been
refactored; otherwise the new pre-commit policy would correctly block the
intermediate extraction commits needed to reach the compliant state.

---

### Task 1: Tracked-file and 500-line repository policy

**Files:**
- Create: `scripts/repository-policy/tracked-files.mjs`
- Create: `scripts/repository-policy/line-limit.mjs`
- Create: `scripts/repository-policy/line-limit.test.mjs`
- Create: `scripts/check-line-limit.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `trackedFiles(repositoryRoot: string): string[]`.
- Produces: `classifyLineLimitedPath(path: string): 'included' | 'exempt'`.
- Produces: `physicalLineCount(bytes: Uint8Array): number | null`, where `null` means binary.
- Produces: `inspectLineLimit(repositoryRoot: string, options?: { maxLines?: number }): { passed: boolean; checkedCount: number; violations: Array<{ path: string; lines: number; maxLines: number }> }`.
- Produces CLI: `npm run check:line-limit`, with deterministic JSON under `-- --json`.

- [ ] **Step 1: Write the failing policy tests**

Create real temporary Git repositories and commit fixtures. Cover a 500-line TypeScript file, a 501-line TypeScript file, CRLF input, binary input, exempt docs/fixtures/lockfiles, and an ignored nested `.worktrees` repository. Derive expected paths and counts as literals.

```js
test('rejects a tracked 501-line source file while accepting 500 lines', () => {
  const repository = committedRepository({
    'packages/example/src/pass.ts': repeatedLines(500),
    'packages/example/src/fail.ts': repeatedLines(501),
  });
  expect(inspectLineLimit(repository)).toEqual({
    passed: false,
    checkedCount: 2,
    violations: [{ path: 'packages/example/src/fail.ts', lines: 501, maxLines: 500 }],
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test scripts/repository-policy/line-limit.test.mjs`

Expected: FAIL because `tracked-files.mjs` and `line-limit.mjs` do not exist.

- [ ] **Step 3: Implement the minimal policy**

Use `git ls-files -z` for inventory, normalize separators to `/`, classify only the spec-approved surfaces/extensions, detect NUL bytes as binary, and count the final non-newline-terminated physical line correctly. Sort violations by path.

- [ ] **Step 4: Verify synthetic policy behavior GREEN**

Run: `node --test scripts/repository-policy/line-limit.test.mjs`

Expected: all policy tests pass.

- [ ] **Step 5: Prove the repository-level RED state**

Run: `npm run check:line-limit`

Expected: FAIL, naming every current in-scope file over 500 lines and no exempt evidence, GoalBuddy, fixture, binary, or lockfile path.

- [ ] **Step 6: Commit the policy foundation**

```bash
git add package.json scripts/check-line-limit.mjs scripts/repository-policy
git commit -m "test: add tracked file-size policy"
```

### Task 2: Exactly-one test-suite ownership

**Files:**
- Create: `scripts/repository-policy/verification-manifest.mjs`
- Create: `scripts/repository-policy/verification-policy.mjs`
- Create: `scripts/repository-policy/verification-policy.test.mjs`
- Create: `scripts/check-verification-manifest.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `verificationSuites: Record<string, { kind: 'vitest' | 'playwright' | 'node' | 'command'; files?: string[]; command: string; args: string[]; public: boolean; fast: boolean }>`.
- Produces: `verificationTiers: Record<'fast' | 'pr' | 'full', string[]>`.
- Produces: `discoverTrackedTests(repositoryRoot: string): string[]`.
- Produces: `validateVerificationManifest(repositoryRoot: string, suites, tiers): { passed: boolean; unowned: string[]; multiplyOwned: Array<{ path: string; suites: string[] }>; unknownNodes: string[] }`.

- [ ] **Step 1: Write the failing manifest tests**

Pressure unowned tests, duplicate ownership, unknown tier nodes, private suites in the public tier, and an exact valid manifest. Also exercise the real repository and expect an explicit unowned inventory before the manifest exists.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/repository-policy/verification-policy.test.mjs`

Expected: FAIL because ownership validation is absent.

- [ ] **Step 3: Implement manifest validation**

Discover `*.test.{ts,tsx,js,mjs}` and `*.spec.{ts,tsx,js,mjs}` only from `git ls-files`. Require one primary owner for every discovered test. Keep non-test commands such as typecheck/build/privacy as leaf nodes without file ownership.

- [ ] **Step 4: Declare the current suite taxonomy**

Assign pure domain/import/compiler-support/preview/review/protocol/policy tests to `fast-unit`. Assign service, recovery, parity, acquisition, determinism, visual, Playwright, Chrome, and private files to their distinct suites. Do not rename tests solely for classification.

- [ ] **Step 5: Verify GREEN**

Run: `node --test scripts/repository-policy/verification-policy.test.mjs && npm run check:verification-manifest`

Expected: all tracked tests owned exactly once; zero unknown tier nodes; zero private suites in `pr`.

- [ ] **Step 6: Commit suite ownership**

```bash
git add package.json scripts/check-verification-manifest.mjs scripts/repository-policy
git commit -m "test: declare non-overlapping verification suites"
```

### Task 3: Verification DAG runner

**Files:**
- Create: `scripts/repository-policy/verification-dag.mjs`
- Create: `scripts/repository-policy/verification-dag.test.mjs`
- Create: `scripts/run-verification.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `resolveVerificationTier(tier: string, suites, tiers): string[]`, topologically ordered and deduplicated.
- Produces: `runVerification(options: { repositoryRoot: string; tier?: string; suites?: string[]; json?: boolean; spawn?: SpawnAdapter }): Promise<VerificationReceipt>`.
- Produces receipt: `{ schemaVersion: 'motion.verification-receipt.v1'; passed: boolean; selected: string[]; results: Array<{ suite: string; status: 'passed' | 'failed' | 'skipped'; durationMs: number; exitCode: number | null }> }`.
- Produces CLIs: `npm run verify:fast`, `npm run verify:pr`, and `npm run verify:full`.

- [ ] **Step 1: Write failing DAG behavior tests**

Use a fake spawn adapter only at the process boundary. Assert literal execution order, one execution for a shared dependency, cycle rejection, unknown-node rejection, failure-dependent skipping, independent-node continuation policy, and timestamp-free JSON structure.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/repository-policy/verification-dag.test.mjs`

Expected: FAIL because the DAG resolver and runner do not exist.

- [ ] **Step 3: Implement resolver and runner**

Use `spawn` with `shell: false`, inherit output for human runs, capture only structured status/duration metadata, and forward termination signals. Local tiers run serially. A failed suite prevents its dependants and returns nonzero.

- [ ] **Step 4: Verify GREEN and no duplicate execution**

Run: `node --test scripts/repository-policy/verification-dag.test.mjs`

Expected: all DAG tests pass with each selected leaf executed once.

- [ ] **Step 5: Commit the DAG runner**

```bash
git add package.json scripts/run-verification.mjs scripts/repository-policy
git commit -m "feat: run verification through one DAG"
```

### Task 4: Worktree-safe fast testing

**Files:**
- Modify: `vitest.config.ts`
- Create: `vitest.fast.config.ts`
- Create: `scripts/repository-policy/test-discovery.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `vitest.config.ts` supplies repository-wide excludes for `.git`, `.worktrees`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `vendor`, caches, and generated browser output.
- `vitest.fast.config.ts` consumes the manifest-owned `fast-unit` paths.
- `test:unit` becomes a compatibility alias for the `fast-unit` leaf.

- [ ] **Step 1: Write the failing discovery test**

Create a synthetic sibling `.worktrees/other/packages/leak.test.ts`, run Vitest list from the active repository, and assert the leak path is absent. Assert every listed fast file equals the literal sorted manifest ownership and no slow-suite path is present.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/repository-policy/test-discovery.test.mjs`

Expected: FAIL because the current configuration permits sibling worktree discovery and `test:unit` selects slow tests.

- [ ] **Step 3: Add explicit exclusions and fast configuration**

Use Vitest `exclude` plus an explicit `include` derived from `fast-unit`. Do not depend on broad `packages/**` discovery for the fast tier.

- [ ] **Step 4: Verify GREEN and benchmark**

Run:

```bash
node --test scripts/repository-policy/test-discovery.test.mjs
/usr/bin/time -p npm run test:unit
```

Expected: discovery tests pass; no Chrome/SQLite/subprocess warnings appear; measured runtime is reported, with a target below ten seconds.

- [ ] **Step 5: Commit fast isolation**

```bash
git add package.json vitest.config.ts vitest.fast.config.ts scripts/repository-policy
git commit -m "perf: isolate the fast test tier"
```

### Task 5: Husky commit/push and GitHub Actions enforcement

**Files:**
- Create: `.husky/pre-commit`
- Create: `.husky/pre-push`
- Create: `scripts/repository-policy/git-hooks.test.mjs`
- Create: `.github/workflows/verification.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Husky is a development dependency and `prepare` invokes `husky`.
- `.husky/pre-commit` executes `npm run check:line-limit` followed by `npm run check:verification-manifest`.
- `.husky/pre-push` executes `npm run verify:fast`.
- CI job names remain stable: `policy-fast`, `integration`, `recovery-parity`, `determinism-visual`, `browser`, `typecheck-build`.

- [ ] **Step 1: Write failing hook behavior tests**

Use a temporary linked worktree and a fake `npm` earlier on `PATH`. Prove the
pre-commit hook selects both policy commands, the pre-push hook selects only
`verify:fast`, each hook executes in the active worktree, failures propagate,
and neither hook hard-codes the source checkout.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/repository-policy/git-hooks.test.mjs`

Expected: FAIL because Husky and the committed hooks do not exist.

- [ ] **Step 3: Install Husky and implement both hooks**

Install Husky as a development dependency, set `prepare` to `husky`, initialize
the committed hook directory, and keep both hooks POSIX-compatible and under
the line limit. Do not add lint-staged: the line and manifest policies must
inspect the complete tracked repository, while the fast tier already owns its
explicit files.

- [ ] **Step 4: Add CI using manifest leaf selections**

Use Node `22.22.0`, `npm ci`, npm caching, pull-request and `main` push triggers, and concurrency cancellation. Each job calls `node scripts/run-verification.mjs --suite ...` so local and CI suite definitions cannot drift. Private suites are absent.

- [ ] **Step 5: Verify hook and workflow behavior GREEN**

Run:

```bash
node --test scripts/repository-policy/git-hooks.test.mjs
npm run prepare
git config --get core.hooksPath
npm run check:line-limit
npm run check:verification-manifest
npm run verify:fast
```

Expected: tests pass; Husky owns the configured hook path; both policy commands
and fast verification pass once the production refactors complete. Before that
final condition, record only the expected line-limit failure.

- [ ] **Step 6: Commit enforcement surfaces**

```bash
git add .husky .github/workflows/verification.yml package.json package-lock.json scripts/repository-policy
git commit -m "ci: enforce fast verification and file limits"
```

### Task 6: Split domain, compiler, and protocol boundaries

**Files:**
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/src/model.ts`
- Create: `packages/domain/src/schema.ts`
- Create: `packages/domain/src/canonical.ts`
- Create: `packages/domain/src/timeline.ts`
- Create: `packages/domain/src/structural-authoring.ts`
- Modify: `packages/css-compiler/src/index.ts`
- Create: `packages/css-compiler/src/compile.ts`
- Create: `packages/css-compiler/src/warped-keyframes.ts`
- Create: `packages/css-compiler/src/safety.ts`
- Create: `packages/css-compiler/src/format.ts`
- Modify: `packages/motion-protocol/src/index.ts`
- Create: `packages/motion-protocol/src/operation-schemas.ts`
- Create: `packages/motion-protocol/src/read-schemas.ts`
- Create: `packages/motion-protocol/src/parsers.ts`
- Create: `packages/motion-protocol/src/commands.ts`
- Create: `packages/motion-protocol/src/client.ts`

**Interfaces:**
- Existing imports from each package `index.ts` remain valid and export the same names.
- Internal modules import concrete dependencies directly; only consumers use the barrel.
- No schema version, diagnostic code, canonical byte, compiler byte, or request path changes.

- [ ] **Step 1: Record focused pre-refactor receipts**

Run:

```bash
npx vitest run packages/domain packages/css-compiler/src/determinism.test.ts packages/motion-protocol/src/index.test.ts packages/motion-protocol/src/review.test.ts
```

Expected: current focused tests pass. Save counts and deterministic digests in the task notes, not new tracked evidence.

- [ ] **Step 2: Extract the domain by dependency direction**

Move types first, then schemas/validation, canonicalization, timeline projection, and structural authoring. Keep `index.ts` as explicit re-exports. After each module move, run `npx vitest run packages/domain`.

- [ ] **Step 3: Extract compiler pure helpers before orchestration**

Move formatting and safety inspection, then warped-keyframe logic, leaving `compileMotionDocument` orchestration in `compile.ts`. Run determinism tests after each move and compare receipt digests.

- [ ] **Step 4: Extract protocol schemas, parsers, builders, and client**

Keep Zod schema dependency direction one-way: operation schemas -> response/read schemas -> parsers/builders -> client. Run protocol and review tests after each move.

- [ ] **Step 5: Verify line and boundary gates**

Run:

```bash
npm run check:line-limit
npm run typecheck
npm run build
npx vitest run packages/domain packages/css-compiler/src/determinism.test.ts packages/motion-protocol/src
```

Expected: these production files are absent from line violations and focused behavior passes.

- [ ] **Step 6: Commit core boundary extraction**

```bash
git add packages/domain/src packages/css-compiler/src packages/motion-protocol/src
git commit -m "refactor: split domain compiler and protocol modules"
```

### Task 7: Split import, browser acquisition, and project-store boundaries

**Files:**
- Modify: `packages/css-import/src/index.ts`
- Create: `packages/css-import/src/inventory.ts`
- Create: `packages/css-import/src/css-parser.ts`
- Create: `packages/css-import/src/source-binding.ts`
- Create: `packages/css-import/src/animation-materializer.ts`
- Create: `packages/css-import/src/import-diagnostics.ts`
- Modify: `packages/browser-resolved-preprocessor/src/acquisition.ts`
- Create: `packages/browser-resolved-preprocessor/src/acquisition-model.ts`
- Create: `packages/browser-resolved-preprocessor/src/resource-locks.ts`
- Create: `packages/browser-resolved-preprocessor/src/browser-route.ts`
- Create: `packages/browser-resolved-preprocessor/src/acquisition-validation.ts`
- Modify: `packages/local-service/src/sqlite-project-store.ts`
- Create: `packages/local-service/src/store/transaction.ts`
- Create: `packages/local-service/src/store/motion-execution.ts`
- Create: `packages/local-service/src/store/control-execution.ts`
- Create: `packages/local-service/src/store/review-storage.ts`
- Create: `packages/local-service/src/store/store-reads.ts`

**Interfaces:**
- Importer and acquisition `index.ts`/public exports remain byte-compatible at their consumers.
- `SqliteProjectStore` remains the sole persistent writer and retains its constructor and public methods.
- Store extraction accepts an explicit internal context `{ database, compiler, clock, faultHook }`; no second writer is introduced.

- [ ] **Step 1: Record focused pre-refactor receipts**

Run importer/materializer, acquisition, service, recovery, and review-handoff suites directly. Expected: current tests pass and counts are recorded.

- [ ] **Step 2: Extract importer pure parsing and binding modules**

Move diagnostics/constants first, then inventory and parser, then stable source binding and animation materialization. Run import/materialize/five-scene public tests after every extraction.

- [ ] **Step 3: Extract browser acquisition boundaries**

Keep resource-lock validation independent from browser execution. Keep the serialized browser route in one module with explicit input/output types. Run `acquisition.test.ts` only after structural moves that affect it because it is a slow integration suite.

- [ ] **Step 4: Extract store operations without changing transaction ownership**

Keep `BEGIN IMMEDIATE`, commit/rollback, operation replay, and fault injection in `transaction.ts`. Motion, control, and review functions receive the same transaction context and never open databases independently.

- [ ] **Step 5: Verify focused behavior and line limit**

Run:

```bash
npx vitest run packages/css-import/src/import.test.ts packages/css-import/src/materialize.test.ts packages/css-import/src/five-scene.test.ts
npx vitest run packages/browser-resolved-preprocessor/src/index.test.ts packages/browser-resolved-preprocessor/src/acquisition.test.ts
npm run test:phase3:service
npm run test:phase3:recovery
npm run test:phase4:review-handoff
npm run check:line-limit
npm run typecheck
```

- [ ] **Step 6: Commit import/acquisition/store extraction**

```bash
git add packages/css-import/src packages/browser-resolved-preprocessor/src packages/local-service/src
git commit -m "refactor: split import acquisition and store modules"
```

### Task 8: Split the editor composition root and styles

**Files:**
- Modify: `apps/editor/src/main.ts`
- Modify: `apps/editor/src/styles.css`
- Create: `apps/editor/src/editor/dom.ts`
- Create: `apps/editor/src/editor/state.ts`
- Create: `apps/editor/src/editor/durable-publication.ts`
- Create: `apps/editor/src/editor/preview-controls.ts`
- Create: `apps/editor/src/editor/timeline-controls.ts`
- Create: `apps/editor/src/editor/cue-workspace.ts`
- Create: `apps/editor/src/editor/shot-workspace.ts`
- Create: `apps/editor/src/editor/shot-geometry.ts`
- Create: `apps/editor/src/editor/operation-dispatch.ts`
- Create: `apps/editor/src/styles/foundations.css`
- Create: `apps/editor/src/styles/timeline.css`
- Create: `apps/editor/src/styles/shot-workspace.css`
- Create: `apps/editor/src/styles/cue-workspace.css`
- Create: `apps/editor/src/styles/responsive.css`

**Interfaces:**
- `main.ts` remains the Vite entry point and composes `mountEditor(payload)` from focused modules.
- Editor modules consume one explicit `EditorContext` object rather than importing mutable globals from `main.ts`.
- `operation-dispatch.ts` remains the only editor path to persistent mutation.
- `styles.css` becomes ordered `@import` statements preserving cascade order exactly.

- [ ] **Step 1: Record focused pre-refactor receipts**

Run editor unit-adjacent tests, the smallest representative Playwright tests for local authoring, durable publication, cues, and shot geometry, then capture computed-style/geometry receipts through existing assertions.

- [ ] **Step 2: Introduce `EditorContext` with no behavior move**

Define the shared state and DOM references in `state.ts` and `dom.ts`. Construct the context in `main.ts`. Run typecheck and one smoke browser test.

- [ ] **Step 3: Extract mutation and publication paths**

Move dispatch, immutable refresh, event reconciliation, draft conflict, and operation preparation as a unit. Verify the service-backed Playwright cases before moving UI rendering.

- [ ] **Step 4: Extract preview/timeline and cue workspace**

Move native preview control without introducing a second interpolator. Move cue rendering, target overlays, path drag, forms, and diagnostics together. Run cue browser specs and compiler-source equality assertions.

- [ ] **Step 5: Extract shot workspace and geometry**

Separate pure pose/trajectory calculations from DOM gesture orchestration. Keep typed operation preparation unchanged. Run moments, integrated dogfood, and Phase 3 focused specs.

- [ ] **Step 6: Split CSS by existing cascade regions**

Copy rule blocks without selector or declaration edits, import them in original order, and run responsive/hit-ownership/browser screenshots already asserted by Playwright and Chrome QA.

- [ ] **Step 7: Verify editor boundary and limit**

Run:

```bash
npm run typecheck
npm run build
npm run test:browser
npm run check:line-limit
```

Expected: compiler-native preview, focus/history, durable publication, geometry, cues, responsive behavior, and selectors remain green; all editor source/style files are at most 500 lines.

- [ ] **Step 8: Commit editor extraction**

```bash
git add apps/editor/src
git commit -m "refactor: split editor composition and styles"
```

### Task 9: Split installed-Chrome QA and oversized tests

**Files:**
- Modify: `apps/editor/scripts/qa-chrome.mjs`
- Create: `apps/editor/scripts/qa/harness.mjs`
- Create: `apps/editor/scripts/qa/diagnostics.mjs`
- Create: `apps/editor/scripts/qa/canvas-first.mjs`
- Create: `apps/editor/scripts/qa/spatial-parity.mjs`
- Create: `apps/editor/scripts/qa/landing-shot.mjs`
- Create: `apps/editor/scripts/qa/asymmetric-primary.mjs`
- Create: `apps/editor/scripts/qa/hit-ownership.mjs`
- Modify: `apps/editor/tests/phase3.spec.ts`
- Create: `apps/editor/tests/phase3-publication.spec.ts`
- Create: `apps/editor/tests/phase3-workspace.spec.ts`
- Create: `apps/editor/tests/phase3-collaboration.spec.ts`
- Create: `apps/editor/tests/phase3-recovery.spec.ts`
- Modify: `apps/editor/tests/editor.spec.ts`
- Create: `apps/editor/tests/editor-creation.spec.ts`
- Create: `apps/editor/tests/editor-authoring.spec.ts`
- Create: `apps/editor/tests/editor-responsive.spec.ts`
- Create: `apps/editor/tests/support/editor-harness.ts`
- Modify: `packages/local-service/src/durable-contract.test.ts`
- Create: `packages/local-service/src/durable-discovery.test.ts`
- Create: `packages/local-service/src/durable-operations.test.ts`
- Create: `packages/local-service/src/durable-diagnostics.test.ts`
- Modify: `packages/domain/src/authoring.test.ts`
- Create: `packages/domain/src/structural-authoring.test.ts`
- Create: `packages/domain/src/keyframe-authoring.test.ts`
- Create: `packages/domain/src/history-authoring.test.ts`

**Interfaces:**
- `qa-chrome.mjs` remains the stable CLI and dispatches parsed flags to scenario modules.
- QA scenarios share browser/server/diagnostic helpers and emit existing schema versions and fields unchanged.
- Split test files retain every existing test title and assertion; shared setup moves to test-only helpers.
- Manifest ownership is updated atomically for renamed/split test paths.

- [ ] **Step 1: Capture test-title inventories**

List current Vitest and Playwright tests to sorted temporary files. These inventories are the independent oracle that no test disappears during splitting.

- [ ] **Step 2: Extract QA harness and scenarios**

Move reusable server, browser, port, CLI, and diagnostic helpers first. Then move each flag-selected scenario. Run each existing `qa-chrome.mjs` invocation separately and compare sanitized receipt schema/count fields.

- [ ] **Step 3: Split Playwright specifications by behavior**

Move complete `test(...)` blocks, not fragments. Keep shared fixtures in `support/editor-harness.ts`. Update the manifest after each split and compare sorted test-title inventories.

- [ ] **Step 4: Split durable and authoring unit/integration tests**

Move behavior groups with their local fixtures. Do not move helper-only methods into production. Run each resulting test file directly.

- [ ] **Step 5: Prove no coverage deletion and no line violations**

Run:

```bash
npm run check:verification-manifest
npm run check:line-limit
npm run test:browser
npm run qa:chrome
npx vitest run packages/local-service/src packages/domain/src
```

Compare sorted before/after test titles; expected missing title count is zero.

- [ ] **Step 6: Commit QA and test decomposition**

```bash
git add apps/editor/scripts apps/editor/tests packages/local-service/src packages/domain/src scripts/repository-policy/verification-manifest.mjs
git commit -m "refactor: split browser QA and large test suites"
```

### Task 10: Remove verification overlap and preserve compatibility

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/repository-policy/verification-manifest.mjs`
- Modify: `docs/browser-qa-loop.md`
- Create: `docs/verification.md`

**Interfaces:**
- Compatibility scripts select leaf suites or DAG tiers but contain no `&&` chain of verification commands.
- `qa:chrome` selects only Chrome QA leaves.
- `test:unit` selects only `fast-unit`.
- `verify:phase3` selects the Phase 3 public leaves once.
- `verify:pr` and CI consume the same manifest suite identifiers.

- [ ] **Step 1: Write a failing manifest/command pressure test**

Extend verification-policy tests to execute package-script resolution and reject aggregate script recursion, `qa:chrome` selecting Playwright, and any test file appearing in two leaves.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/repository-policy/verification-policy.test.mjs`

Expected: FAIL on current compatibility script nesting until rewired.

- [ ] **Step 3: Rewire scripts to leaf selections**

Keep familiar command names but route them through `run-verification.mjs --suite` or `--tier`. Delete duplicate path lists from `package.json` after the manifest owns them.

- [ ] **Step 4: Document the intended loop**

Document fast inner loop, focused leaf selection, pre-commit and pre-push
behavior, public PR graph, full/private acceptance, hook bypass semantics, and
how to add a test with exactly one suite owner. Update browser QA instructions
so complete public proof runs once at final convergence rather than after every
tiny correction.

- [ ] **Step 5: Verify GREEN**

Run policy tests and print dry-run suite selections for `fast`, `pr`, `full`, `phase3`, and `qa:chrome`. Assert every selection is deduplicated and private leaves occur only in `full`.

- [ ] **Step 6: Commit the final verification contract**

```bash
git add package.json package-lock.json scripts/repository-policy docs/browser-qa-loop.md docs/verification.md
git commit -m "docs: define tiered verification workflow"
```

### Task 11: Final adversarial verification

**Files:**
- Inspect: complete branch diff
- Inspect: every file reported by the policy
- Modify only if a verified defect is found: files already owned by Tasks 1-10

**Interfaces:**
- User-facing claim: local development has an isolated fast tier, all public
  proof is non-overlapping, Husky pre-commit/pre-push and CI enforce the same
  500-line policy, and product behavior remains unchanged.

- [ ] **Step 1: Verify the hard ratchet**

Run:

```bash
npm run check:line-limit
npm run check:verification-manifest
npm run verify:fast
```

Expected: zero oversized in-scope files, zero unowned/duplicate tests, fast tier green, no slow-runtime warnings.

- [ ] **Step 2: Run the complete public DAG once**

Run: `npm run verify:pr`

Expected: every public leaf passes once. Preserve the structured receipt showing selected suites, durations, and zero duplicate execution.

- [ ] **Step 3: Run installed-Chrome and authorized private evidence**

Run the Chrome leaves. Run private leaves only when their ignored authorized inputs are present; otherwise report exact unavailable diagnostics and do not fabricate inputs.

- [ ] **Step 4: Inspect workflow enforcement**

Run both Husky hooks directly in synthetic successful and failing repositories,
including a committed 501-line fixture. Validate the workflow YAML syntax and
confirm every CI command resolves to a manifest node.

- [ ] **Step 5: Inspect complete diff and privacy**

Run:

```bash
npm run check:sensitive
npm run check:private-ignore
git diff --check origin/main...HEAD
git status --short
```

Inspect all changed paths. Confirm no private content, database, screenshot, generated browser artifact, or absolute corpus path is tracked.

- [ ] **Step 6: Re-state the top three failure modes with direct evidence**

1. Ratchet skips a file/test: cite tracked-inventory and exactly-one ownership receipts.
2. Refactor changes behavior: cite public DAG, browser, Chrome, deterministic digest, typecheck, and build receipts.
3. Faster tests weakened proof: cite before/after test-title inventory and full DAG leaf counts.

- [ ] **Step 7: Commit any final documentation-only receipt correction**

Only if required after fresh evidence:

```bash
git add docs/verification.md
git commit -m "docs: record verification workflow"
```
