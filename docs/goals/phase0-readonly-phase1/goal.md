# Phase 0 and Read-Only Phase 1

## Objective

Complete Phase 0 and only the read-only portion of Phase 1 with a credible
vertical slice: fail-closed import, an authoring-capable canonical motion
document, deterministic pure HTML/CSS compilation, a sandboxed native-animation
preview, a complete read-only timeline, controlled Chromium visual proof, an
interactive Chrome walkthrough, and sanitized evidence. Stop for architecture
review before Phase 2.

## Original Request

Complete Phase 0 and only read-only Phase 1 from the incubation plan. Use the
private first scene locally without copying it into the repository. Prove the
complete nine-rule/eight-application import, deterministic export, browser-owned
scrubbing, visual equivalence around discrete boundaries, and sensitive-content
exclusion. Use GoalBuddy with rigorous grounded criteria, Chrome QA, and a
synthetic example animation. Use the public landing animation only to confirm
that the schema and timeline remain authoring-capable, and do not expand into
Phase 2.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Motion architecture owner
- Authority: `approved`
- Proof type: `demo`
- Completion proof: fresh tests, build, controlled Chromium comparison,
  interactive Chrome walkthrough, sanitized receipts, and a final adversarial
  audit jointly prove every approved exit criterion.
- Goal oracle: the private first scene imports completely, compiles
  deterministically, scrubs via browser-created animations, and matches the
  baseline exactly at stable frames and both sides of discrete boundaries.
- Likely misfire: ship an attractive timeline or public example while omitting
  a source animation, silently accepting unsupported CSS, implementing a second
  interpolator, weakening proof thresholds, leaking private material, or
  crossing into Phase 2.
- Blind spots considered: raw track keyframes are distinct from narrative shot
  cues; responsive variants can multiply rule definitions; pseudo-elements and
  discrete timing need visible diagnostics; controlled Chromium proof and an
  interactive Chrome walkthrough answer different risks.
- Existing plan facts: the approved design is
  `docs/superpowers/specs/2026-08-10-phase0-readonly-phase1-design.md`; the
  incubation plan and repository invariants remain authoritative.

## Goal Oracle

The oracle for this goal is:

`One sanitized final evidence bundle maps complete private import inventory,
three-run baseline stability, repeated byte-identical export, exact controlled-
Chromium visual equivalence, native-animation scrub receipts, interactive
Chrome walkthrough results, sensitive-content exclusion, tests, type checking,
and build output to every approved Phase 0/read-only Phase 1 exit criterion.`

The PM must keep comparing task receipts to this oracle. Planning, a synthetic
demo, or passing unit tests alone are not enough. The goal finishes only when a
final Judge records `full_outcome_complete: true` and explicitly confirms the
architecture-review stop.

## Goal Kind

`existing_plan`

## Current Tranche

Implement the complete approved Phase 0/read-only Phase 1 vertical slice in the
current feature worktree. The work advances continuously through three large,
reversible packages: motion/import/compiler foundations; preview/timeline and a
synthetic example; then visual proof/private acceptance/sanitized receipts.
Judge reviews occur at the initial plan boundary, the import/compiler fidelity
boundary, and final completion.

## Grounded Acceptance Criteria

### Import and canonical document

- A complete inventory records imported, unsupported, and missing constructs.
- The private first scene yields exactly nine keyframe-rule records and eight
  animation-application records, including its ordered simultaneous slots,
  staggered delays, and both step-timed tracks.
- Every animation-bearing element/property is represented by a stable canonical
  element ID and track; selector hints are not identity.
- Unsupported motion-bearing input produces a deterministic error diagnostic
  and no partial canonical document.
- Canonical serialization is schema-versioned and byte-stable.

### Compiler and export

- The compiler rebuilds all motion CSS from structured canonical rules,
  applications, slots, tracks, and keyframes; it does not preserve imported
  motion declarations as an opaque escape hatch.
- Equal canonical bytes produce byte-identical HTML/CSS and equal digests on at
  least three consecutive runs.
- Export is pure HTML/CSS with no production animation runtime.

### Preview and timeline

- The sandboxed iframe displays the compiler's exact output.
- Play, pause, and scrub operate on browser-created animation objects and their
  `currentTime`; no JavaScript property interpolation exists.
- The read-only timeline shows every element/property track, keyframe, delay,
  simultaneous slot, step timing, and narrative cue.
- Stable element IDs remain visible independently from selector hints.
- A neutral public synthetic example demonstrates continuous, discrete, step,
  delay, shared-rule, simultaneous-slot, cursor, copy, and hold constructs
  without reproducing private or public product branding, copy, media, or
  layout.

### Visual proof and Chrome QA

- The controlled proof environment uses the repository-pinned Playwright
  Chromium revision and a declared viewport.
- Readiness waits for DOM, fonts, and stable consecutive layout measurements.
- The baseline is replayed three times and corresponding frame hashes match.
- Samples include stable frames plus `t-1 ms` and `t+1 ms` around every derived
  discrete or step boundary.
- Baseline and compiled output have zero changed pixels, zero changed-pixel
  ratio, and zero maximum channel delta at every sample.
- Interactive Chrome QA loads the editor, verifies all timeline rows, scrubs to
  every declared cue, confirms preview state and animation current time, and
  exercises play/pause without console errors.
- Controlled Chromium and interactive Chrome identities are recorded
  separately; the walkthrough does not replace deterministic proof.

### Safety and repository proof

- Private manifests, generated canonical files, and screenshots remain only in
  ignored local locations.
- Tracked receipts contain only digests, technical counts, sanitized diagnostic
  codes, tool identities, and aggregate diff results.
- A tracked-file and complete branch-diff scan finds no private path, username,
  source fragment, product copy, branding, screenshot, media, database,
  credential, token, or presigned URL.
- Focused tests, full tests, type checking, production build, receipt validation,
  and repository checks pass from exact recorded commands.

## Public Landing Reference: Shot Cues, Not Scope

Live Chrome inspection of the public 14-second landing loop identified the
following narrative cue taxonomy. It is a read-only authoring-readiness
reference, not an implementation target:

| Cue | Time |
| --- | ---: |
| Loop start | 0 ms |
| File landed | 700 ms |
| Transcript ready | 2,100 ms |
| First selection | 2,940 ms |
| Second selection | 3,640 ms |
| Range selected | 5,180 ms |
| Treatment chosen | 5,880 ms |
| Preview begins | 6,580 ms |
| First marker | 7,280 ms |
| Second marker | 7,910 ms |
| Third marker | 8,540 ms |
| Preview complete | 8,820 ms |
| Create action | 9,380 ms |
| Processing | 9,800 ms |
| Clean result | 11,480 ms |
| Downloaded | 12,320 ms |
| Reset begins | 13,440 ms |
| Loop restored | 14,000 ms |

The schema must be capable of expressing such cues alongside all underlying
property keyframes. This tranche does not import, recreate, or edit that public
landing animation.

## Non-Negotiable Constraints

- Work only in the current feature worktree and branch.
- Use the private corpus only as local acceptance input and never copy it into
  tracked content.
- Establish only domain, CSS-import, CSS-compiler, preview, editor, and
  visual-proof boundaries needed by this slice.
- No persistent database, sole-writer service, mutation CLI, MCP, claims,
  branches, annotations, review workflow, Lineage adapter, React/Tailwind
  round-trip, video export, package publication, release, push, or pull request.
- No landing-animation implementation.
- CSS selectors are bindings, not stable identity.
- Unsupported input fails visibly and atomically.
- Equal document revisions produce byte-identical exports and receipts.
- Preview renders compiler output and controls browser-created animations.
- Reduced-motion behavior remains inspectable and intentional.
- Use test-first red-green-refactor cycles for production behavior.
- Preserve unrelated user changes and never use destructive Git commands.

## Stop Rule

Stop only when the final Judge proves the full oracle, records
`full_outcome_complete: true`, and confirms that the next action is architecture
review. Do not begin Phase 2.

Do not stop after planning, discovery, synthetic tests, or one Worker package
while safe approved work remains. If private acceptance reveals an unsupported
construct or nondeterministic browser behavior, preserve the failure receipt,
activate the smallest safe corrective package inside this phase, and continue.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. Each Worker owns one
coherent vertical package and must finish its full test, implementation, and
verification cycle. Judges review phase or risk boundaries rather than every
helper file.

## Board Health

The PM owns board health. If the board looks stale or inconsistent, run:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase0-readonly-phase1
```

## Canonical Board

Machine truth lives at:

`docs/goals/phase0-readonly-phase1/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/phase0-readonly-phase1/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase0-readonly-phase1/goal.md.
```

## PM Loop

On every `/goal` continuation, read this charter and `state.yaml`, follow the
GoalBuddy execution contract, work only on the active task, record a compact
receipt, update board truth, and advance to the next safe package. Before
ending, run GoalBuddy's `check-can-stop.mjs`; only the final audit or a valid
terminal approval wait may pass that gate.
