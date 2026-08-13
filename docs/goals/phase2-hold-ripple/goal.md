# Phase 2 Insert Hold and Ripple Retime

## Objective

Complete the next major Phase 2 operation: let a motion author insert a 600 ms hold at an existing narrative cue and ripple every later cue/keyframe/application timing forward while preserving story order, deterministic compilation, native preview, exact history, and visual equivalence outside the intentional retime.

## Original Request

Proceed through the recommended sequence after UX simplification. The planned Phase 2 exit test is to extend the typing/reveal beat by 600 ms without editing CSS while preserving later story order.

## Goal Oracle

`In fresh Chrome, an author chooses the approved reveal/typing boundary, inserts a 600 ms hold through one typed canonical operation, sees every affected later cue and track move exactly 600 ms while earlier states and relative later order remain unchanged, scrubs native compiler output across the new hold boundaries, and undo/redo restores exact digests and rasters.`

## Current Tranche

One complete insert-hold/ripple-retime vertical slice. T001 defines the exact canonical boundary, affected inventory, operation/replay semantics, UI, and visual proof. T002 implements the whole safe slice. Visible QA and final audit follow. Stop before persistence/Phase 3.

## Constraints

- Work only in `.worktrees/phase2-hold-ripple` on `codex/phase2-hold-ripple`.
- Reuse the typed expected-revision reducer and simplified workflow.
- Preserve stable identity; selectors remain bindings only.
- Preview remains exact compiler HTML controlled through browser-created CSSAnimation objects.
- Unsupported/ambiguous retimes fail atomically; no per-frame JS interpolation.
- No generalized drag system, arbitrary multi-selection, persistence, service, CLI/MCP, claims, branches, Lineage integration, landing work, publication, push, or PR.
- Private corpus stays ignored/local; tracked evidence remains sanitized.

## Stop Rule

Stop only after a final Judge proves the 600 ms hold/ripple oracle with domain, compiler, Chrome, visual-boundary, history, privacy, build, and complete-diff evidence. Do not enter Phase 3.

## Canonical Board

Machine truth lives at `docs/goals/phase2-hold-ripple/state.yaml`.
