# Phase 3 control recovery and refresh hardening

## Objective

Implement and prove only the approved Phase 3 Slice 3 recovery and live-refresh hardening path. Extend crash and lost-response recovery across branch and claim controls; add durable ordered SSE reconnect and immutable refetch; preserve canonical-ID selection; show visible dirty-draft conflicts without silently applying or discarding local input; and fail closed on integrity or migration faults. Stop for architecture review before Slice 4.

## Original Request

Create a fresh worktree and complete Phase 3 Slice 3 control recovery and refresh hardening, including real Chrome QA, then stop for architecture review.

## Intake Summary

- Input shape: `existing_plan`
- Audience: motion editor owner
- Authority: `approved`
- Proof type: `test`
- Completion proof: a final Judge accepts exact recovery, reconnect, draft-conflict, stable-identity, Chrome, deterministic, integrity, migration, and privacy evidence for Slice 3 only.
- Goal oracle: a real CLI and two editor pages exercise connected refresh, disconnect/reconnect, dirty local drafts, stable selection, branch isolation, and the full branch/claim control crash matrix against the sole-writer service.
- Likely misfire: adding a generic collaboration framework or making SSE reconnect visually appear to work without proving durable ordering, immutable refetch, dirty-draft safety, and recovery atomicity.
- Blind spots considered: event-gap detection, duplicate replay, post-commit lost responses, claim-secret retry binding, branch-scoped selection reconciliation, dirty drafts whose target disappears, migration rollback, corrupted head/digest refusal, hidden second writers, private evidence leakage, and browser-native preview continuity.
- Existing plan facts: Slice 1 durable authoring and Slice 2 minimum branches/claims are merged through `e07a187`; the approved architecture names Slice 3 as control recovery and refresh hardening; Slice 4 alone owns the aggregate Phase 3 proof.

## Goal Oracle

The oracle for this goal is:

`From one synthetic seed, the real CLI and two open editor pages use the same externally provisioned clients against one locked SQLite-owning service. Exact process/fault tests prove every branch and claim control exposes only the complete pre-state or complete post-state after begin/insert/pre-commit/post-commit response loss, and identical retries never duplicate state. Chrome proves an ordered CLI commit refreshes the correct branch through immutable refetch; disconnect/reconnect replays from commit_seq or explicitly refetches the head; canonical-ID selection survives; a local unsubmitted draft is visibly stale and never silently applied or overwritten; exact compiler-native CSS animations and reduced motion remain inspectable; and receipts contain zero sensitive content.`

Planning, an SSE connection, or a partial crash test is not completion. A final Judge must map fresh receipts to the complete oracle and record `full_outcome_complete: true` for Slice 3.

## Goal Kind

`existing_plan`

## Current Tranche

Execute one coherent Slice 3 vertical package after a read-only Judge grounds the exact contract against the merged Slice 2 baseline. The package spans only the service/store recovery boundary, ordered event replay/refetch, shared client, editor reconciliation, CLI-driven proof, browser tests, Chrome QA, and sanitized receipts needed for this slice.

This tranche does not implement Slice 4 aggregate Phase 3 proof as a new product feature. It does not add merge, review, annotations, claim listing, generalized collaboration, MCP, Lineage integration, publication, video, Phase 4 coach-mark breadth, or later phases.

## Non-Negotiable Constraints

- One loopback service remains the only database owner and persistent writer.
- Every persistent control retains expected-revision, lease-version, idempotency, authorization, and post-commit notification semantics.
- Crash or response-loss recovery exposes only the exact pre-state or exact committed post-state; rejected or rolled-back operations consume nothing.
- Reconnect uses durable monotonically ordered metadata replay from `commit_seq` or an explicit immutable head refetch; it never reconstructs canonical state from event payloads.
- The editor fetches compiler input from immutable revisions and renders the existing compiler output, never a JavaScript interpolation engine.
- Selection reconciles only by canonical IDs. CSS selectors remain source bindings.
- Unsubmitted form drafts are visibly stale after a conflicting remote revision and are never silently replayed, submitted, overwritten, or discarded.
- Claim secrets and capabilities remain outside URLs, browser persistence, logs, deterministic receipts, screenshots, databases in plaintext, and committed evidence.
- Preserve deterministic export, stable IDs, native HTML/CSS, reduced-motion inspection, private-corpus exclusion, and all merged Phase 0–Slice 2 behavior.
- Commit only synthetic fixtures and sanitized evidence. Do not commit SQLite, WAL, backups, discovery files, absolute paths, screenshots, credentials, private copy, selectors, URLs, or payload-bearing receipts.
- No dependency, package publication, release, push, or pull request without separate authorization.

## Adversarial Proof Standard

Before handoff, state the owner-facing claim and challenge these top three realistic failures:

1. A crash or lost response around a control transaction duplicates an event/claim, consumes an operation ID, or leaves a branch head, lease, revision, and receipt inconsistent.
2. An event gap, reconnect, duplicate replay, or cross-branch notification makes the editor render the wrong immutable revision or silently overwrite a dirty local draft.
3. Recovery or refresh hardening creates a second writer, weakens shared protocol parity, loses canonical-ID selection, diverges compiler output, or leaks claim/capability/private content.

Direct evidence must include the full branch-create and claim acquire/renew/release/revoke fault matrix; lost-response committed retry; WAL/restart and branch-head digest validation; migration rollback and unsupported/corrupt refusal; connected and reconnecting CLI refresh; duplicate/gap ordering; stable-ID and disappeared-target behavior; visible dirty-draft conflict and explicit resolution path; exact native preview and reduced motion; deterministic repetition; sensitive/private-ignore scans; focused and repository gates; and complete diff inspection.

## Stop Rule

Stop only when the final Judge proves the Slice 3 oracle complete or records an exact phase/risk/authority blocker. Do not stop after planning or partial recovery helpers while safe in-scope work remains.

Stop for architecture review once Slice 3 is complete. Do not activate Slice 4 or claim the aggregate Phase 3 exit gate.

## Slice Sizing

The intended Worker package is the largest safe coherent recovery-and-refresh vertical slice. Do not split each control kind, crash point, SSE callback, or editor field into separate tasks unless a Judge proves the combined package unsafe. Recovery semantics and browser reconciliation share one contract and should be reviewed together.

## Canonical Board

Machine truth lives at:

`docs/goals/phase3-control-recovery/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/phase3-control-recovery/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase3-control-recovery/goal.md.
```

## PM Loop

On every execution continuation, read this charter and the GoalBuddy execution contract, follow only the active task in `state.yaml`, require role-shaped receipts, maintain exactly one active task, and run the GoalBuddy stop checker before ending. Final completion requires a Judge receipt with `full_outcome_complete: true` mapped to the original owner outcome.
