# Phase 3 aggregate proof and exit gate

## Objective

Complete only the approved Phase 3 Slice 4 aggregate proof. Re-run and, only where the read-only audit proves necessary, minimally close gaps in the proof harness so one sanitized evidence package demonstrates all ten product invariants across import, deterministic compilation, native preview, human and CLI authoring, sole-writer persistence, branches, claims, recovery, reconnect, and browser behavior. Stop at the Phase 3 exit decision before Phase 4.

## Original Request

After merging Phase 3 Slice 3, create a fresh worktree and prepare the bounded GoalBuddy board for the aggregate Phase 3 proof and exit gate.

## Intake Summary

- Input shape: `existing_plan`
- Audience: motion editor owner
- Authority: `approved`
- Proof type: `decision`
- Completion proof: a final Judge maps fresh, reproducible evidence to every Phase 3 invariant and records `full_outcome_complete: true` only if the aggregate exit gate passes.
- Goal oracle: clean repeated runs from the same synthetic base produce byte-identical canonical documents, compiled HTML/CSS, exports, and sanitized receipts through both editor and CLI paths; all service, recovery, branch, claim, reconnect, browser, Chrome, import, visual, privacy, and repository gates pass without adding product behavior.
- Likely misfire: treating the proof tranche as permission for a generalized feature, or declaring Phase 3 complete from stale slice receipts without one fresh aggregate run.
- Blind spots considered: stale or self-affirming receipts, omitted legacy invariants, editor/CLI byte drift, nondeterministic receipt fields, private corpus leakage, hidden SQLite artifacts, browser preview divergence, and tests that pass without exercising installed Chrome.
- Existing plan facts: Slices 1–3 are merged through `f4e1368`; the approved Phase 3 architecture assigns Slice 4 only aggregate proof, invariant non-regression, deterministic repetition, privacy scanning, and full browser/Chrome evidence.

## Goal Oracle

The oracle for this goal is:

`From one synthetic seed and the ignored private acceptance manifest, two clean aggregate runs prove the same immutable bases yield byte-identical canonical documents, canonical digests, compiled native HTML/CSS, export digests, and sanitized receipts through editor and CLI paths. Fresh service, concurrency, recovery, branch, claim, replay/refetch, draft-conflict, import, visual, browser, and installed-Chrome evidence maps explicitly to all ten repository invariants; sensitive and private-ignore scans report zero; and no Phase 4+ behavior or private material enters the repository.`

Planning, inherited slice receipts, or a single green command is not completion. A final Judge must independently inspect the complete diff and evidence, challenge the top failure modes, and record `full_outcome_complete: true` for the complete Phase 3 exit gate.

## Goal Kind

`existing_plan`

## Current Tranche

Execute one proof-first Slice 4 package after a read-only Judge grounds the exact merged baseline, enumerates every required invariant and acceptance command, and decides whether any minimal proof-harness change is needed. Prefer zero product-code changes. If evidence wiring is incomplete, allow only the smallest synthetic tests, scripts, package command, or sanitized receipt necessary to make the aggregate claim reproducible.

This tranche does not add authoring operations, schema or migration behavior, service capabilities, UI workflows, merge/review, annotations, MCP, Lineage integration, publication, video export, Coach Mark breadth, landing animation work, or any Phase 4+ feature.

## Non-Negotiable Constraints

- The final claim must be supported by fresh evidence from the merged Slice 3 base, not copied status from earlier boards.
- Every one of the ten repository product invariants must map to an exact test, trace, inspection, or Chrome assertion.
- Repeat canonical serialization, compilation, export, and receipt generation from identical immutable inputs and require byte identity.
- Editor and CLI parity must compare canonical documents, digests, compiled HTML/CSS bytes, export digests, and sanitized receipts from identical bases.
- Preview and scrubbing must continue to use browser-created animations from compiler output; no JavaScript interpolation engine may appear.
- Installed-Chrome QA must cover CLI-triggered refresh, ordered reconnect/refetch, visible dirty-draft conflict behavior, stable canonical-ID selection, native CSS animation, reduced motion, and zero unexpected console, request, or network failures.
- Unsupported imports remain fail-closed and visible. Private acceptance inputs remain ignored and outside the repository.
- Commit no private source, copy, branding, selectors, URLs, absolute corpus paths, screenshots, databases, WAL/backup/discovery files, credentials, tokens, or payload-bearing receipts.
- No dependency, migration-history, package-lock, product-schema, publication, release, push, pull request, or Phase 4 work without separate authority.

## Adversarial Proof Standard

Before handoff, state the owner-facing claim and challenge these top three realistic failures:

1. The aggregate command is green while silently omitting a Phase 0–3 invariant, relying on stale receipts, or failing to exercise the installed-browser and real-service paths.
2. Equal immutable bases drift across editor/CLI or repeated runs in canonical bytes, compiled HTML/CSS, export digests, receipts, preview output, or discrete-boundary visual samples.
3. The proof package or repository leaks private corpus material, absolute paths, selectors, product copy, screenshots, credentials, tokens, SQLite/WAL files, or another out-of-scope artifact.

Direct evidence must include a complete ten-invariant matrix; fresh service and concurrency tests; the full authoring/branch/claim crash and lost-response matrix; restart, integrity, migration, and unsupported-schema refusal; editor/CLI byte parity; deterministic repeated exports and receipts; fail-closed import inventory; visual proof around discrete boundaries; browser and installed-Chrome reconnect/draft/stable-ID/native-preview/reduced-motion checks; sensitive/private-ignore scans; repository checks; complete diff inspection; exact commands, counts, environment, and sanitized aggregate results.

## Stop Rule

Stop only when the final Judge proves the complete Phase 3 oracle or records an exact blocker. Do not stop at planning, a partial verification run, or an unreviewed receipt while safe in-scope proof work remains.

Stop at the Phase 3 exit decision. Do not begin Phase 4, expand the private corpus, implement landing animation behavior, or create later packages.

## Slice Sizing

The intended Worker package is one largest-safe proof vertical: aggregate command/evidence wiring, deterministic repetition, sanitized receipt, and any narrowly necessary synthetic proof corrections. A Judge must define exact allowed files before the Worker starts. Product implementation files are excluded unless the Judge demonstrates a concrete Phase 3 invariant defect that cannot be proven or corrected within the proof surface; such a defect is a stop-and-recontract condition, not implicit scope.

## Canonical Board

Machine truth lives at:

`docs/goals/phase3-aggregate-proof/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/phase3-aggregate-proof/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase3-aggregate-proof/goal.md.
```

## PM Loop

On every execution continuation, read this charter and the GoalBuddy execution contract, follow only the active task in `state.yaml`, require role-shaped receipts, maintain exactly one active task, and run the GoalBuddy stop checker before ending. Final completion requires a Judge receipt with `full_outcome_complete: true` mapped to the complete Phase 3 owner outcome.
