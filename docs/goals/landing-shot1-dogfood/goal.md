# Landing Shot 1 Dogfood

## Objective

Execute the approved landing Shot 1 dogfood slice: prove the complete private
loop is reachable without weakening import safety, then let the owner adjust
existing object trajectories, grouped movement, pose, timing, easing, and a
settled hold through deterministic browser-native CSS.

## Original Request

Return to the Bleep landing animation, separate it into shots, and dogfood the
first shot by adjusting object placement, trajectories, grouping, speed, and
easing. Use the approved design and implementation plan, keep private material
local, and stop for owner QA and architecture review before expanding further.

## Intake Summary

- Input shape: `existing_plan`
- Audience: product owner creating and iterating short CSS animations
- Authority: `approved`
- Proof type: `demo`
- Completion proof: the owner completes the exact installed-Chrome Shot 1
  walkthrough and receipts prove complete import, native preview, deterministic
  export, exact history, boundary containment, and sensitive-content exclusion
- Goal oracle: an installed-Chrome owner walkthrough of the digest-locked
  private Shot 1 workflow, backed by compiler, history, visual, and privacy
  receipts
- Likely misfire: build an attractive synthetic path editor even though the
  private complete loop cannot pass the fail-closed importer, or let UI edits
  bypass the shared domain/service operation language
- Blind spots considered: shot cues are owner configuration rather than
  importer inference; geometry and temporal easing remain distinct; grouping
  is ephemeral and atomic rather than a persistent hierarchy; later-shot
  unsupported features cannot be silently discarded; the first shot must not
  mutate Shot 2
- Existing plan facts:
  `docs/superpowers/specs/2026-08-18-landing-shot1-dogfood-design.md` and
  `docs/superpowers/plans/2026-08-19-landing-shot1-dogfood.md` are approved and
  their required order, non-goals, private-data rules, and hard preflight gate
  must be preserved

## Goal Oracle

The oracle for this goal is:

`Installed-Chrome owner completion of the digest-locked private Shot 1 workflow, with equal compiler/native preview, exact undo/redo, three byte-identical exports, complete-loop inventory, boundary-safe edits, and zero private leakage.`

The PM must compare every Worker receipt to this oracle. Synthetic tests are
necessary but cannot establish private dogfood readiness. Completion requires a
final Judge mapping evidence to the oracle with `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the approved plan, pass the private full-loop preflight, implement the
smallest closed trajectory workflow, carry it through the shared durable
operation boundary, prove it in the real compiler/native preview and controlled
visual harness, and stop after owner manual QA plus architecture review. The
first safe package is the read-only/private preflight test and sanitized
receipt; production-package implementation remains forbidden until it passes.

## Non-Negotiable Constraints

- Keep the private source, manifest, resources, selectors, screenshots, copy,
  branding, absolute paths, databases, and detailed receipts untracked.
- Unsupported import features fail visibly; never weaken or silently drop them.
- Stable element and keyframe identity must not depend on CSS selectors.
- Human editor and CLI dispatch the same strict typed domain operations through
  the local service once persistence is involved.
- Preview renders compiler output and scrubbing controls browser-created
  `CSSAnimation` objects; do not add a JavaScript interpolation engine.
- Equal revisions produce byte-identical exports and sanitized receipts.
- Shot 1 edits do not move later keyframes or alter Shot 2.
- No freehand paths, spatial Bézier handles, permanent groups, arbitrary
  keyframe creation, responsive generalization, publication, or Lineage work.
- Use one feature branch/worktree and one pull request; do not publish or merge
  without explicit authorization.

## Stop Rule

Stop immediately for architecture review if the complete private loop fails the
approved preflight gate, if its focal trajectories require unsupported
composition, if cue boundaries require semantic inference, or if sanitized
evidence cannot be produced. Otherwise continue through every safe queued
package and stop only after final adversarial proof and owner manual QA.

Do not treat planning, a synthetic fixture, a passing isolated operation, or a
clean board as completion. Do not start the rest of the landing stress test.

## Slice Sizing

Each Worker owns one coherent reversible vertical package. The preflight is
intentionally small because it is a hard risk gate. After it passes, combine
same-layer work where doing so proves a useful end-to-end behavior; do not split
the work into one task per helper, field, or operation.

## Board Health

The PM owns board health. Validate it with:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/landing-shot1-dogfood
```

## Canonical Board

Machine truth lives at:

`docs/goals/landing-shot1-dogfood/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/landing-shot1-dogfood/goal.md.
Claude Code: /goalbuddy Follow docs/goals/landing-shot1-dogfood/goal.md.
```

## PM Loop

On every continuation, read this charter and `state.yaml`, re-check the intake
and hard gate, work only the active task, record a compact evidence receipt,
advance to the next largest safe package, and review at the preflight, durable
boundary, private-proof, and final-completion gates. Before ending execution,
run the GoalBuddy `check-can-stop.mjs` gate. A nonzero result means safe work
remains or the terminal approval-wait shape is invalid.
