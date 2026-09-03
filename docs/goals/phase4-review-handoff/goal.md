# Phase 4 revision-linked review and handoff

## Objective

Implement the fourth ordered Phase 4 slice as one bounded end-to-end review
workflow: revision-linked annotations, immutable comparison, and a sanitized,
deterministic handoff receipt, all through the existing sole-writer service and
shared human/agent operation boundary.

## Original Request

Continue after merging the five-scene import-closure slice by preparing the next
recommended Phase 4 review-and-handoff tranche in a fresh goal and worktree.

## Intake Summary

- Input shape: `existing_plan`
- Audience: motion editor owner and human/agent collaborators
- Authority: `approved`
- Proof type: `demo`
- Completion proof: a browser-visible annotation and immutable comparison workflow plus CLI parity produces byte-identical sanitized handoff receipts without changing canonical motion or leaking private bodies.
- Goal oracle: two immutable revisions can be reviewed, annotated, compared, and handed off through shared typed operations while compiler/export identity remains unchanged and stale, unauthorized, or conflicting writes fail atomically.
- Likely misfire: building project-management workflow, putting annotations inside the motion document, making comparison mutable, producing payload-bearing receipts, or stopping after schemas/helpers without a complete protocol-to-browser path.
- Blind spots considered: annotation version races; document/branch revision drift; agent claim scope; idempotent retries; immutable annotation snapshots; incomplete handoff identity; private-body leakage; comparison accidentally mutating or promoting a revision; benchmark records being invented before Slice 5; and editor/CLI divergence.
- Existing plan facts: Slice 4 follows merged five-scene closure; annotations live outside canonical motion; comparison is read-only across immutable revisions; handoff is deterministic and allowlisted; Slice 5 owns performance benchmarking; Phase 5 owns the landing stress test.

## Goal Oracle

The oracle for this goal is:

`From two immutable motion revisions, the human editor and claimed agent can perform the exact annotation lifecycle, inspect a read-only comparison, and independently derive the same sanitized handoff bytes while canonical/compiler/export output stays unchanged and private annotation bodies never enter public evidence.`

The PM must compare every receipt to this oracle. A schema, reducer, service
endpoint, CLI command, isolated component, or synthetic unit proof is not
completion. Final completion requires a Judge receipt with
`full_outcome_complete: true` for Slice 4.

## Goal Kind

`existing_plan`

## Current Tranche

First map the merged service, revision, claims, protocol, CLI, editor, compiler,
and receipt boundaries and validate the architecture contract. Then implement
the largest safe end-to-end package that closes annotation create/edit/resolve/
reopen/delete, immutable comparison, and deterministic handoff through browser
and CLI evidence. Finish with adversarial atomicity, determinism, privacy, and
Chrome proof. Stop at the Slice 4 gate.

## Non-Negotiable Constraints

- Work only in the prepared `codex/phase4-review-handoff` worktree based on merged `origin/main`; preserve the dirty main checkout and every unrelated worktree.
- Annotations remain service-owned and outside `MotionDocument`, canonical serialization, compilation, preview bytes, export, and canonical revision allocation.
- Annotation writes require authenticated authority, expected annotation version, applicable document/branch revision, and an active claim for agents. Stale, unauthorized, conflicting, or faulted writes allocate and publish nothing.
- Allowed annotation actions are exactly create, edit, resolve, reopen, and delete. Do not add approvals, assignments, merge/apply actions, publishing, notifications, or project-management status.
- Comparison is a read-only view of two immutable revisions. It cannot merge, apply, mutate, accept, promote, or redirect either side.
- Handoff bytes derive purely from the complete versioned `HandoffIdentityInput`: schema/serializer versions, opaque document and branch IDs, immutable revision identity and canonical digest, immutable annotation snapshot identity/digest, and ordered included comparison/proof records. Benchmark records remain an explicit empty list until Slice 5.
- Handoff output is allowlisted. Never expose annotation bodies, source-derived payloads, source copy, branding, selectors, filenames, paths, resource locations, screenshots, credentials, or private identifiers.
- Human editor and agent CLI dispatch the same typed operations through the loopback sole-writer service. Equal requests and complete identity tuples produce byte-identical stored responses and handoff bytes.
- Compiler output and browser-created animations remain authoritative; review data may not change canonical, compiler, preview, export, proof, or revision identity.
- Use synthetic public fixtures only in tracked tests. Private bodies may exist only in ephemeral local test storage and must be absent from logs, receipts, snapshots, and committed artifacts.
- Use a named localhost subdomain for browser QA.
- Do not add generalized collaboration workflow, benchmark execution, Phase 5 pseudo-element or landing work, MCP, Lineage integration, publication, release, deployment, push, or pull request without separate authority.

## Adversarial Proof Standard

The final audit must state the user-facing claim and challenge these three
realistic failure modes with direct evidence:

1. Annotation bodies or mutable review state enter canonical/export identity, browser evidence, service responses, logs, or handoff receipts.
2. Stale versions, stale revisions, missing claims, retries, concurrent writes, or injected transaction faults partially mutate annotation state or publish refresh events.
3. Comparison or handoff omits an identity input, changes with ordering or process restarts, permits mutation/promotion, or differs between editor and CLI despite equal immutable inputs.

Evidence must include the complete five-action annotation lifecycle; successful
human and claimed-agent operations; stale/unauthorized/conflict/fault rejection;
restart and idempotency proof; unchanged canonical/compiler/export digests;
immutable two-revision comparison; explicit empty absent-category lists;
repeated byte-identical handoff output; installed-Chrome browser walkthrough;
editor/CLI parity; private-body sentinel scans; repository checks; and focused
plus regression test results.

## Stop Rule

Stop only when the final Judge proves the Slice 4 oracle or records an exact
blocker after all safe local work is exhausted. Do not stop after discovery,
schema work, or one isolated endpoint while a safe end-to-end package remains.
Stop before Slice 5 benchmarking and Phase 5.

## Slice Sizing

Treat revision-linked review and handoff as one user-visible tranche. Scout and
Judge may split implementation into a small number of dependency-ordered Worker
packages only when file ownership or risk requires it; every package must still
cross the shared operation, sole-writer, persistence, and proof boundaries. Do
not create helper-only or one-action-per-task churn.

## Board Health

Run:

```bash
node <goalbuddy-skill-root>/scripts/check-goal-state.mjs docs/goals/phase4-review-handoff
```

## Canonical Board

Machine truth lives at:

`docs/goals/phase4-review-handoff/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/phase4-review-handoff/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase4-review-handoff/goal.md.
```

## PM Loop

On every execution continuation, read this charter and the GoalBuddy execution
contract, follow only the active task in `state.yaml`, require role-shaped
receipts, keep exactly one active task, and run the GoalBuddy stop checker before
ending. Final completion requires a Judge receipt with
`full_outcome_complete: true` for this slice only.
