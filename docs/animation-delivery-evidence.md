# Animation delivery evidence

This index maps the approved [A–M delivery plan](animation-delivery-plan.md) to
public proof. It describes product behavior, not an execution transcript.
At this documentation snapshot, main is `864b027`; the shot workflow and
sequence foundation/storyboard are merged. Agent sequence work in
[PR #34](https://github.com/lineagehq/lineage-motion/pull/34) and complete journeys
in [PR #37](https://github.com/lineagehq/lineage-motion/pull/37) have local acceptance;
final integration checks remain required. A passing older head does not prove a
new main commit. Node M is not yet complete.

## Scenario to proof

Paths below are repository-relative test entry points. The
[verification manifest](../scripts/repository-policy/verification-manifest.mjs)
owns their suites; [verification](verification.md) describes how to run them.

| User-facing claim | Direct test evidence |
| --- | --- |
| A–B: ordinary startup, durable restart and isolated browser service lifecycle | `apps/editor/tests/normal-startup.spec.ts`, `apps/editor/tests/normal-agent-smoke.spec.ts` |
| C–D: hooks inspect actual staged/pushed content; draft checks cannot satisfy ready requirements | `scripts/repository-policy/exact-hooks.test.mjs`, `git-hooks.test.mjs`, `ci-policy.test.mjs`, `ci-runner.test.mjs` in the same directory; [live migration receipt](verification.md#ci-selection-and-aggregate-gate) |
| E–G: normal shot entry, agent discovery/claims and usable canvas/recovery | `apps/editor/tests/project-entry.spec.ts`, `normal-canvas.spec.ts` in the same directory; `packages/motion-cli/src/managed-admission.test.ts`, `managed-authoring.test.ts`, `managed-session.test.ts` in the same directory |
| H: saved shot export is independent and equivalent through UI/CLI | `apps/editor/tests/shot-export.spec.ts`, `packages/motion-cli/src/shot-export.test.ts` |
| I: pinned sources, conservative viewport, atomic persistence/recovery and native composition | `packages/css-compiler/src/sequence-runtime.test.ts`, `sequence-viewport.test.ts` in the same directory; `packages/local-service/src/sequence-integrity.test.ts`, `sequence-recovery.test.ts` in the same directory; `packages/visual-proof/src/sequence-composition.visual.test.ts` |
| J: storyboard drafts, selection, playback, native clock and unrelated shot navigation survive failure | `apps/editor/tests/sequence-storyboard.spec.ts` |
| K: agent assembly/retry, UI/CLI canonical and ZIP parity, restart, native cut frames | `packages/motion-cli/src/sequence-workflow.test.ts`, `sequence-selection.test.ts`, `sequence-recovery.test.ts` in the same directory; `apps/editor/tests/sequence-parity.spec.ts` |
| L: five fresh complete workflows, keyboard operation, service-off artifact and meaningful motion timing | `apps/editor/tests/animation-delivery.spec.ts`, `animation-delivery-helpers.ts`, `animation-delivery-motion.spec.ts` in the same directory |
| M: actual delivered main remains integrated and protected | Required final local mixed smoke, full public manual regression, exact commit/CI links and protection inspection in the final handoff PR; pending at this snapshot |

## Complete journey measurements

The L source accepted in `671168f` was tested on production inputs from
`e37f90802a080c11f491e1fa48c121f9ca847376`. Later ancestry integration changed only
an unrelated Phase 3 test helper; it did not change these runtime inputs.
Each browser ran five fresh journeys plus an adversarial motion-metric test.
Pinned Chromium **151.0.7922.34** passed all six in **40.4s**; installed Chrome
**152.0.7977.76** passed all six in **44.1s**. Node was **v22.22.3**. Type checking
also passed. Timings include launcher startup after dependency installation.

| Journey | Viewport | First authored motion, Chromium / Chrome | Complete task, Chromium / Chrome | Control actions / navigations / user CLI commands |
| --- | --- | --- | --- | --- |
| UI-only | 1280×720 | 2.166s / 2.308s | 5.727s / 6.731s | 42 / 3 / 0 |
| CLI-only authoring | 1440×900 | 2.696s / 2.564s | 7.464s / 7.480s | 7 / 5 / 23 |
| Mixed desktop | 1280×720 | 2.536s / 2.601s | 7.361s / 10.244s | 39 / 4 / 13 |
| Mixed large desktop | 1440×900 | 2.961s / 2.901s | 9.572s / 8.447s | 36 / 4 / 13 |
| Mixed keyboard mobile | 390×844 | 2.446s / 2.557s | 9.190s / 9.353s | 36 / 4 / 13 |

CLI-only means CLI authoring/export with read-only browser playback inspection.
Keyboard UI authoring uses real focus traversal and keys: 1,026 key presses in
Chromium and 1,024 in Chrome. All journeys start the launcher twice to prove
restart. Oracle instrumentation is separate from user actions. Automated timing
meets the approved 120s/600s budgets; it is not a human usability study.

The public [Opening](../fixtures/public-synthetic/animation-opening.html) and
[Ending](../fixtures/public-synthetic/animation-ending.html) scenes are 320×180,
two and three seconds long. Each starts with one imported animation track;
authored Caption Fade brings the observed count to two. Every observed inventory
has zero unsupported and missing animations. Source receipts record actual
source, canonical, export, HTML and CSS digests and pinned revisions.

The completed animation orders Ending before Opening, with a 500ms Ending hold.
Tests sample 0, 1500, 2999, 3000, 3001, 3499, 3500, 3501, 4500, 5499, 5500 and
5501ms. Independent expectations check native position, opacity and visible shot,
including reduced motion. Exports remain byte-identical after restart; extracted
HTML plays with the service stopped and makes no HTTP requests. Synthetic ZIP,
screenshot and JSON receipt attachments are available for the final handoff.

## Challenges and limits

Three realistic failures define the acceptance evidence:

- Saved pins or native cut frames diverge between editor and offline output:
  independent frame expectations and canonical/archive parity detect this.
- Keyboard, stale-agent or connectivity recovery loses drafts or mutates the
  wrong state: invalid-input retention, atomic rejection and retry of the exact
  dispatched request are exercised.
- A timing probe mistakes static visibility for authored motion: the probe
  requires advancing native animation time and changing computed opacity;
  separate static and frozen-positive cases must be rejected.

[Hook and CI timing evidence](verification.md#ci-selection-and-aggregate-gate)
and [hook behavior](local-hooks.md) remain the authoritative development-loop
references. Final handoff must record current budget measurements, live required
checks, merged PRs, exact main revision and successful final regression/local
smoke. Keep those resulting-main receipts in the handoff PR so documenting a
successful final run does not itself create another unverified source commit.

Only public synthetic inputs were used for this delivery proof. It does not
establish private-corpus compatibility, cross-browser coverage beyond the named
Chromium engines, video export, responsive composition, Lineage integration or
a stable published API. The [scope index](phase-status.md) and original plan
retain those boundaries.
