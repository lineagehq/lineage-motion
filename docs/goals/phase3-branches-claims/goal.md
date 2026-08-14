# Phase 3 Minimum Branches and Claims

## Objective

Implement and prove only the approved second Phase 3 vertical slice: minimum
branch creation and head reads plus bounded CLI-agent document or branch claims
through the existing loopback sole-writer service. Keep the human editor and
agent CLI on the same typed operation language and stop for architecture review
when this slice is complete.

## Original Request

After PR #2 is reviewed, fixed, merged, and verified, create a fresh worktree
and prepare the bounded GoalBuddy board for Phase 3 Slice 2. Do not implement
Slice 2 during goal preparation.

## Intake Summary

- Input shape: `existing_plan`
- Audience: motion editor owner
- Authority: `approved`
- Proof type: `test`
- Completion proof: a final Judge accepts exact automated and installed-Chrome
  evidence for every approved Slice 2 branch/claim contract, while the complete
  diff and evidence remain free of sensitive content.
- Goal oracle: a synthetic editor/CLI walkthrough and exact tests prove branch
  creation/head reads and atomic claim acquire, renew, release, human
  revocation, authorization, retry, and revision interaction through the sole
  writer.
- Likely misfire: building schemas or generic collaboration infrastructure
  without a complete usable vertical path, or pulling merge/review and later
  recovery work into this slice.
- Blind spots considered: secret leakage; stale revision and lease-version
  races; overlapping claim acquisition; lost-response idempotency; editor/CLI
  contract drift; accidental Phase 4+ scope.
- Existing plan facts: merged PR #2 is the verified Slice 1 baseline; the
  approved architecture defines Slice 2 as minimum branch creation/head reads
  and CLI-agent document or branch leases with renewal, release, human
  revocation, client-retained secrets, verifier-only storage, idempotent control
  events, authorization failures, and atomic head-revision interaction. Merge
  and review behavior remain excluded.

## Goal Oracle

The oracle for this goal is:

`From one synthetic seed, the real CLI and editor use the same versioned clients against one locked SQLite-owning service; exact tests and a Chrome walkthrough show deterministic branch heads and authorized writes, exactly one winner for overlapping claims, safe acquire/retry/renew/release/revoke behavior, atomic stale rejection, no plaintext claim secret outside the client, compiler-native preview continuity, and zero sensitive evidence findings.`

The PM must compare every task receipt to this oracle. Contracts, migrations,
passing happy-path tests, or a clean board are not enough. The goal finishes
only when a final Judge maps fresh evidence back to this oracle and records
`full_outcome_complete: true` for Slice 2.

## Goal Kind

`existing_plan`

## Current Tranche

This goal executes one coherent Phase 3 Slice 2 package after a read-only Judge
grounds the exact contract and file boundary. The Worker should complete the
entire approved branch/claim path across protocol, store, service, CLI, editor,
and proof rather than stopping at helper types or one endpoint. A final Judge
then audits the full slice and stops for architecture review.

This tranche does not claim Slice 3 refresh/recovery hardening or the aggregate
Phase 3 exit gate.

## Non-Negotiable Constraints

- One local service remains the only persistent writer and the only SQLite
  importer.
- Editor and CLI dispatch the same strict, versioned typed operations.
- Every persistent mutation names an expected document revision; lease changes
  additionally use the approved lease-version compare-and-swap contract.
- Branch and claim controls are atomic, idempotent, rollback-safe, and consume
  no durable IDs or state when rejected.
- Claims are bounded to an exact branch or document. Client-generated claim
  secrets remain client-retained; storage holds only a verifier.
- Stable element identity remains independent from CSS selectors.
- Equal revisions produce byte-identical compiler output and sanitized
  receipts; preview remains exact compiler output using browser-native CSS
  animations.
- Reduced-motion behavior remains inspectable.
- Use only synthetic public fixtures. Never commit private corpus files,
  screenshots, branding, copy, product content, absolute private paths,
  credentials, presigned URLs, or local databases.
- Do not add merge, review, annotations, broad collaboration, SSE replay or
  dirty-draft hardening, MCP, Lineage integration, React/Tailwind round-trip,
  video, publication, release, push, or PR creation without separate authority.
- Stop for architecture review once Slice 2 is fully implemented and proven.

## Adversarial Proof Standard

Before completion, state the owner-facing claim and directly defeat the top
three realistic failure modes:

1. Concurrent or stale branch/claim controls partially mutate heads, leases,
   events, or receipts.
2. Claim secrets leak or authorization can be bypassed, confused across scope,
   or replayed after renewal/revocation.
3. CLI/editor/service/store semantics drift, or the editor stops rendering the
   exact compiler-native revision after branch/claim activity.

The proof package must include focused protocol/store/service tests,
concurrency and idempotency barriers, restart/lost-response checks appropriate
to Slice 2, editor/CLI byte parity, deterministic repetition, installed Chrome
QA, repository safety, sensitive/private-ignore checks, typecheck, build, and a
complete-diff inspection. Reuse the merged `verify:phase3` baseline and add
focused Slice 2 gates rather than weakening it.

## Stop Rule

Stop only when a final audit proves the Slice 2 oracle is complete, or an exact
phase/risk/authority blocker is recorded. Do not continue into Slice 3.

Do not stop after the initial Judge or after partial protocol/store scaffolding
if the bounded end-to-end Worker package remains safe. Do not split repeated
same-shape branch/claim controls into tiny tasks.

If implementation would require a deferred feature, secret exposure, a second
writer, relaxed atomicity, weakened verification, or files outside the exact
Worker contract, stop that package and return a grounded receipt.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.
The intended Worker package is the complete minimum branch/claim vertical
slice. T001 may narrow it only when direct repository evidence proves the full
package is not safely reversible or cannot be verified as one unit.

## Board Health

Machine truth lives in `docs/goals/phase3-branches-claims/state.yaml`. If this
charter and the board disagree about status, receipts, or completion, the board
wins.

Check the board with:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase3-branches-claims
```

## Run Command

```text
Codex: /goal Follow docs/goals/phase3-branches-claims/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase3-branches-claims/goal.md.
```

## PM Loop

On every execution continuation, read this charter and `state.yaml`, follow the
GoalBuddy execution contract, work only the active task, store a compact
receipt, and advance the next largest safe task. Before stopping, run the
GoalBuddy can-stop checker. A nonzero result means safe work remains unless the
board records the exact valid approval-wait shape.
