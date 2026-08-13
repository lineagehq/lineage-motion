# Phase 3 Architecture Review

## Objective

Complete the Phase 3 persistence architecture gate before implementation. Resolve the sole-writer local-service boundary, revision and transaction semantics, replaceable storage contract, and editor/CLI operation parity as a small, testable design that preserves all current motion-authoring invariants.

## Original Request

Do the recommended Phase 3 architecture review now, before writing persistence code.

## Intake Summary

- Input shape: `existing_plan`
- Audience: the product owner and the next Phase 3 implementation run
- Authority: `approved`
- Proof type: `decision`
- Completion proof: a durable architecture decision maps every current Phase 3 requirement to explicit contracts, failure behavior, implementation slices, and executable verification criteria.
- Goal oracle: a final Judge demonstrates that the proposed architecture has one persistent writer, atomic expected-revision mutation, shared editor/CLI operations, deterministic sanitized receipts, and no later-phase scope.
- Likely misfire: writing a generic database plan, silently implementing persistence, or prebuilding collaboration and integration features.
- Blind spots considered: hidden secondary writers; stale-write partial mutation; schema migration and crash recovery; UI/CLI semantic drift; private-data persistence or receipt leakage.
- Existing plan facts: local service becomes sole persistent writer; every mutation includes an expected revision and fails atomically when stale; editor and agent CLI share typed domain operations; minimum branch-head and document/branch claim contracts are authoritative Phase 3 scope. This architecture tranche defines but does not implement those contracts, and the first implementation slice defers claims. Phase 4+ review workflow, MCP, Lineage integration, publication, and richer collaboration remain excluded.

## Goal Oracle

The oracle for this goal is:

`A receipt-backed architecture decision and adversarial final audit prove that every Phase 3 persistence invariant has an explicit, minimal, testable contract and that no implementation or later-phase scope entered this tranche.`

The PM must keep comparing task receipts to this oracle. Discovery or a plausible diagram is not enough. Completion requires direct traceability from requirements to contracts, realistic failure modes, verification evidence, and the first bounded implementation slice.

## Goal Kind

`audit`

## Current Tranche

Read the authoritative plan and current repository boundaries; select a minimal Phase 3 architecture; write one durable architecture decision; adversarially audit it; and stop before production implementation. This review should leave the next run ready to create a dedicated Phase 3 worktree and implement only the first verified vertical slice.

## Non-Negotiable Constraints

- Architecture review only; no database, service, CLI, or editor persistence implementation in this goal.
- The local service is the sole persistent writer.
- Mutations use typed operations, name an expected revision, and fail atomically when stale.
- Human editor and agent CLI dispatch the same domain operations.
- Stable element identity remains independent from CSS selectors.
- Equal revisions continue to produce byte-identical exports and sanitized receipts.
- Private corpus, private paths, screenshots, branding, copy, credentials, and local databases remain uncommitted.
- Define the minimum branch-head and document/branch claim contracts required by Phase 3, but do not implement them in this architecture tranche. The first implementation slice also defers claim implementation.
- Do not introduce merge or richer branching workflow, annotations, review workflow, MCP, Lineage integration, remote collaboration, publication, video, CRDTs, or release work.
- Prefer the smallest credible vertical slice over generalized infrastructure.

## Stop Rule

Stop when a final Judge audit proves the architecture gate is complete and records `full_outcome_complete: true`. Do not begin Phase 3 implementation in this goal. If a material choice remains unresolved, record the exact choice and return for owner review.

## Slice Sizing

The architecture must describe the largest safe first implementation slice that proves the whole persistence path: one shared typed envelope and client; one existing operation entering one locked loopback service; one `ProjectStore`-backed SQLite migration; one atomic expected-revision event, revision, and head transaction; one sanitized idempotent receipt; CLI and editor invocation from identical bases; one minimal post-commit SSE refetch into the compiler-backed preview; focused parity and restart tests; and Chrome QA. Minimum branches and claims move to the second slice. Generalized collaboration machinery remains excluded.

## Board Health

The PM owns board health. Check it with:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase3-architecture-review
```

## Canonical Board

Machine truth lives at `docs/goals/phase3-architecture-review/state.yaml`.

## Run Command

```text
Codex: /goal Follow docs/goals/phase3-architecture-review/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase3-architecture-review/goal.md.
```

## PM Loop

Follow the GoalBuddy execution contract, work only the active task, preserve one active task, write compact receipts, and stop only after the final architecture audit maps all evidence back to the oracle.
