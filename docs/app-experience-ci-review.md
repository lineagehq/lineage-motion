# App experience and verification review

Reviewed 2026-09-06 on fresh branch `codex/app-experience-ci-audit`, based on
merged main `19fb528832f8917a833123df781991d4b4ff0cf8`.

This is an assessment and implementation proposal. It changes no application
behavior, hooks, workflows, branch protection, or phase acceptance.

## Assessment

The app has a substantial tested motion-editing engine, but it does not yet
deliver a coherent start-to-finish animation product. Shared operations,
durable edits, conflict handling, compiler output, and canvas moments are real
strengths. The largest missing piece is the user's journey: open a project,
create or import shots, edit them, arrange them, preview the whole animation,
and export a usable artifact.

More isolated controls and broader proof matrices will not close that gap.
Prioritize one small complete two-shot workflow over further feature breadth.

## Findings in priority order

### 1. The normal launch cannot perform its advertised first action

Observed in the browser: run `npm run dev:editor`, select Cursor, click
“Create Cursor opacity track.” The enabled action reports
`SERVICE_REQUIRED: revision 0 unchanged.` The screen initially says “Bring one
element into motion” and does not explain how to start its required service.

The rejection correctly protects the sole-writer invariant. The product defect
is presenting this disconnected editor as the ordinary starting experience.
`package.json` launches Vite alone; the service-backed launcher in
`apps/editor/scripts/serve-editor.mjs` requires database and capability
configuration. Tests provision that setup themselves, bypassing first use.

**Next change:** one documented startup command that starts the existing local
service and editor, manages local configuration, and opens a durable project.
If disconnected, show an actionable connection state before offering edits.
Acceptance: clean checkout to first durable edit and reload, without knowing
environment-variable names or copying capabilities into commands.

### 2. Shot assembly is missing, not merely hidden behind an awkward UI

`MotionDocument` owns one presentation and timeline. There is no first-class
ordered shot sequence in that model. `runFiveSceneClosure` returns individual
scene import results and inventories; it is not a composition compiler.
Neither inspected editor presents create/import shot, duplicate shot, reorder
shots, or whole-sequence export.

**Next product slice:** two shots, hard cuts, one shared viewport, one compiled
HTML/CSS output. Provide a shot strip with thumbnails, names, duration,
selection, duplicate, delete with undo, and keyboard reorder. Clicking a shot
opens the existing canvas; “Play all” uses the same compiler as export.

Keep shot-local timing distinct from sequence placement. Use stable shot IDs
and explicit revision references, and make UI and CLI dispatch the same typed
sequence operations through the existing writer. Do not concatenate arbitrary
CSS: isolate selectors/keyframe names and explicitly model active intervals,
fill behavior, and reduced motion. Reject unsupported composition visibly.
Defer crossfades, nested sequences, mixed viewports, audio, and video export.

This is a proposed capability expansion; the audit does not implement it or
assert a roadmap gate has passed.

### 3. Powerful editing tools are fragmented and still tied to fixtures

`apps/editor/vite.config.ts` chooses fade, landing-shot, cursor/click/reveal,
or reusable-cue experiences through environment variables. Users cannot
navigate naturally between those capabilities inside a project.

The default target choices are specific Cursor/Orb IDs in `main.ts`.
The older `motion.hold.insert` operation hardcodes `cue_pair`, 2870 ms, a
600 ms hold, and a 4660 ms source duration in `structural-authoring.ts`.
The CLI's `hold-insert` also constructs that fixed operation. Newer reusable
hold cues exist; the old command should not imply arbitrary ripple support.

**Recommendation:** derive available actions from the loaded document and
existing eligibility projection. Offer “Move,” “Fade,” “Reveal,” “Type,” and
“Hold” where supported. Keep unsupported actions visibly explained. Replace
fixture-specific restrictions only as required by the two-shot acceptance task.

### 4. The canvas is a sound base, with concrete usability follow-ups

In a service-backed synthetic shot, adding a point between Point 1 and Settle
created a selected point at 1400 ms. Removal selected the surviving point.
Undo restored the point; redo removed it; playback advanced the playhead.
The focused browser suite also passed keyboard, responsive hit-target, and
human/CLI collaboration checks.

At the browser's 1280 by 720 viewport, the scene occupied a small area near the
upper-left of a much larger striped workspace; waypoint labels and handles
were difficult to read. This is an observed sizing problem, not evidence that
all viewports fail. Add a useful centered fit view and readable overlay labels;
keep UI handle sizes independent of content zoom. Verify against actual source
dimensions rather than enlarging the exported content.

Use a single consistent timing presentation (seconds for ordinary authoring,
milliseconds for exact edits), meaningful object/shot names, a clear saved or
pending indicator, and plain recovery messages. Hide raw revisions and claim
mechanics until collaboration or a conflict makes them relevant, while keeping
agent activity and ownership inspectable. Distinguish draft preview from a
committed edit and make one gesture one undo step.

### 5. Agent parity is stronger than agent onboarding and discovery

The real CLI/service parity tests passed. Preserve stable-ID discovery,
expected revisions, scoped claims, preparation, and atomic rejection.
Do not make convenience commands bypass those safeguards.

However, the CLI requires service, capability, document context, operation IDs,
and revisions, and geometry commands expose microunits/ppm. There is no
project-oriented startup/create/import/assemble/export-file journey in command
discovery. `export-proof` returns digests and counts, not an animation file.
`review-handoff` is implemented, but running its `--help` returns
`CLI_COMMAND_UNKNOWN` with exit 2; review commands are omitted from discovery.
The representative commands in `docs/shared-ux-contract.md` are illustrative,
not the executable command syntax.

**Recommendation:** a small session/context layer over the current service:
discover the project and eligible actions, resolve readable names to stable
IDs, claim the exact scope, prepare edits, then report the committed revision
and preview location. Add useful high-level shot operations as the UI gains
them. Support ordinary units at the CLI boundary and structured examples for
every advertised command. Keep secrets in managed local configuration, outside
logs and shareable command snippets. Return actionable errors with the field,
allowed range, and refresh/retry instruction where appropriate.

### 6. Export exists as a compiler capability, not a finished authoring exit

The compiler generates HTML/CSS and deterministic digests, and the service
offers export proof. The inspected authoring screens lack a straightforward
download/export completion flow. Review handoff is an identity/proof receipt;
it is not a substitute for the animation artifact.

Add a clear “Export animation” action and equivalent CLI command. Produce the
HTML/CSS plus receipt, reopen the export outside the editor, and verify that
it plays without the editor service. Surface unresolved imports and the chosen
reduced-motion behavior before export.

## Testing and CI assessment

The single verification manifest and boundary-specific leaves are worth
keeping. Coverage includes service correctness, revision/claim conflicts,
reconciliation, deterministic compilation, visual fidelity, keyboard controls,
and independent CLI/browser work. This is meaningful coverage.

The missing acceptance test is the product journey. Existing tests start
fixture-specific servers and frequently inspect internal editor state. That
is useful for invariants but cannot establish discoverability or completion.
Add one public test that uses the normal launcher and public UI/CLI surfaces:
create/import two shots, edit one in the UI and one through the CLI, reorder,
undo, reload, play all, export, and reopen the output.

Current CI runs six verification jobs on every PR update and main push, plus
separately configured CodeQL checks. A recent documentation/instruction PR
completed in 9m35s: policy-fast took 20s, typecheck-build 22s,
recovery-parity 48s, integration 1m45s, determinism-visual 6m14s, browser 3m.
Browser did not start until about 6m35s after workflow creation; queueing
contributed materially to elapsed time. These are observations from one run,
not a benchmark distribution.

- [Documentation PR run](https://github.com/lineagehq/lineage-motion/actions/runs/34045653409)
- [Reviewed main run](https://github.com/lineagehq/lineage-motion/actions/runs/34046205777)

The reviewed main browser job failed: `PHASE3_SERVER_EXIT_1` while starting
the reconciliation test at line 157; 33 tests passed and three did not run.
The run finished failed; the other five verification jobs passed.
An earlier main run had similar startup failures in different tests. This
suggests a harness/startup reliability problem but does not prove its cause.
The launcher picks random ports from a small range and drops child stderr
from its reported exception. Use one shared lifecycle helper, safer port
allocation, bounded startup logs, and reliable cleanup. Capture failure traces,
screenshots, and logs as CI artifacts; the current workflow does not upload
them. Avoid masking unexplained failures with retries.

CI installs Playwright Chromium, while the editor test config explicitly uses
the Chrome channel. Align the installed browser and test configuration rather
than depending on a runner's preinstalled browser.

The 500-line policy does not measure coupling. Several editor modules import
large portions of mutable state and functions from `main.ts`, which imports
the modules back. Prefer extracting one owned state/controller boundary during
relevant fixes; do not undertake a broad rewrite just to satisfy file length.

## Proposed iteration policy

Hooks already exist. Improve their coverage and accuracy rather than add a
second hook system.

| Stage | Proposed gate | Time budget / purpose |
| --- | --- | --- |
| During editing | Affected manifest leaf | Immediate feedback for the changed behavior |
| Commit | Staged-content privacy, execution-artifact, manifest and size checks; no browsers | Aim below 2s; protect what is actually committed |
| Push | Fast tests, typecheck, build, determinism; small service/parity leaves when their boundaries change | Aim below 10–15s locally; no exhaustive browser/visual suite |
| Every code PR | One lightweight required gate: fast checks, build/types, one public UI/CLI smoke | Aim below 2 minutes including setup; measure rather than promise |
| Ready for review / explicit full-check request | Existing broad public graph | Full evidence before merge, not every draft save |
| Main / scheduled / manual | Broad regression on chosen cadence | Keep regular unattended coverage during iteration |
| Private acceptance | Explicit local authorized-input workflow | Never substitute private scenes into public CI |

Pre-commit currently reads tracked files from the working tree rather than
the exact staged blobs. Pre-push runs `verify:fast` in the current working
directory without processing the refs Git supplies. These checks are helpful
but should not be described as proof of the exact commit being pushed. Test
partial staging and alternate pushed refs when hardening the hooks. Keep the
manifest as the single suite owner and select changed boundaries conservatively;
unknown/shared changes should broaden verification, not silently skip it.

For immediate iteration relief, stop the exhaustive visual/browser graph on
every draft update, skip runtime suites for pure prose changes, and avoid a
second full graph on every merge when equivalent merge evidence exists. A
documentation path exemption must exclude executable HTML/JS design references
and any machine-consumed fixtures/configuration under docs.

Keep cheap determinism and compiler semantics checks. Keep a small browser
smoke because the UI is the product. CodeQL can move to scheduled/manual runs
during incubation if desired; it is relatively short in this sample, so it is
not the first savings target. Disabling it is a deliberate loss of automatic
static security analysis, distinct from reducing repetitive animation tests.

GitHub currently requires all six job names and
`Analyze (javascript-typescript)`, with strict up-to-date PRs. Do not merely
delete workflows: missing required contexts can block merges. Implement the
replacement required gate and update branch protection together. A required
aggregate gate must distinguish intentionally inapplicable suites from failed
or canceled suites and depend on broad results when those are required. Clear
the current unexplained startup failure before making the baseline optional.

## Recommended delivery order and acceptance

1. **Reliable start and fast feedback:** normal service-backed launch, exact
   startup error evidence, fixed CLI discovery, staged commit policies,
   inexpensive push checks, and a measured CI smoke tier.
2. **One useful shot:** import or choose a starter inside the app, select by
   readable name, move/fade/reveal, edit moments, undo, reload, and export.
3. **Two-shot completion:** duplicate/import second shot, reorder hard cuts,
   edit across UI and CLI, preview whole sequence, export and reopen.
4. **Polish against observed friction:** measure time to first visible motion,
   completion without source edits, successful UI/agent handoffs, recovery from
   invalid input, and finished-export fidelity. Set owner-accepted budgets after
   a baseline walkthrough; existing tests do not establish those timings.

## Evidence and limits

Local environment: macOS, Node v22.22.3, npm lockfile installed with `npm ci`,
Vitest v3.2.7, Chrome through the repository Playwright configuration. Browser
inspection used only public synthetic scenes on dedicated named localhost
ports in this worktree. Databases were created outside the repository.

Commands run:

```sh
npm ci
node scripts/run-verification.mjs --tier fast
node scripts/run-verification.mjs --tier fast --suite typecheck --suite build --suite determinism
node scripts/run-verification.mjs --suite parity --suite service-integration
npx playwright test apps/editor/tests/moments.spec.ts apps/editor/tests/integrated-dogfood.spec.ts --config apps/editor/playwright.config.ts
npx tsx packages/motion-cli/src/cli.ts review-handoff --help
```

Explicit suite selection overrides tier selection: the second verification
command above ran only typecheck, build, and determinism. Fast was run separately.
Results: 25 policy + 226 fast-unit + 34 determinism + 25 parity + 35 service
tests passed (345 total); four focused browser tests passed in 8.9s.
Fast leaf durations totaled 1.791s; types/build/determinism totaled 4.644s;
parity/service totaled 3.148s. These are single local samples, not CI promises.
Build passed with a roughly 539 kB minified JS chunk warning. CLI help failed
as described above. The complete public graph, private acceptance, exhaustive
browser QA loop, and new two-shot workflow were not run or certified.

The user-facing claim is that the existing engine is a credible foundation,
but seamless shot-to-animation completion is not yet delivered. Three realistic
ways this assessment could be wrong were challenged directly:

1. **Mistaking hidden working assembly for missing scope:** inspected the
   document model, CLI discovery, editor surfaces, service, and five-scene
   importer. Found per-document editing and import closure, no sequence model.
2. **Mistaking a good-looking demo for shared durable correctness:** ran
   service/parity tests and the real human/CLI browser test, plus direct moment
   creation, removal, undo/redo and playback in the connected editor.
3. **Calling valuable CI unnecessary or trusting stale green evidence:**
   measured local leaves, read current protection and per-job timings, and
   inspected the exact reviewed main's failed browser job. Root cause remains
   unresolved; no blanket green or blanket-disable recommendation is made.
