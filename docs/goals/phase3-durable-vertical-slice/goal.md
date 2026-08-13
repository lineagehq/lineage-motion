# Phase 3 Durable Vertical Slice

## Objective

Implement the first approved Phase 3 vertical slice end to end: one existing typed authoring operation must travel through a shared editor/CLI protocol into a loopback-only sole-writer service, commit atomically to a tool-specific SQLite store, produce a deterministic sanitized receipt, refresh the open editor through post-commit service events, and render the fetched immutable revision through the existing compiler-backed browser preview.

## Original Request

Create the dedicated Phase 3 implementation worktree and implement the documented end-to-end first slice now.

## Intake Summary

- Input shape: `existing_plan`
- Audience: the product owner and the next Phase 3 tranche
- Authority: `approved`
- Proof type: `test`
- Completion proof: from isolated synthetic stores, editor and CLI invocations of the same typed operation produce byte-identical canonical documents, compiled HTML/CSS, digests, and sanitized receipts; stale or invalid writes change nothing; committed state survives restart; an open Chrome editor refreshes from the CLI commit through SSE and the compiler-backed native preview.
- Goal oracle: one executable synthetic end-to-end walkthrough plus service, restart, parity, browser, Chrome, determinism, privacy, and repository gates proves the complete path rather than isolated helpers.
- Likely misfire: building generalized service or schema infrastructure without a working editor/CLI/preview path, or pulling branch and claim implementation into this first slice.
- Blind spots considered: hidden second database writer; SQLite/runtime portability; stale compare-and-swap races; lost responses and idempotent retry; editor draft reconciliation; accidental client persistence; private data in databases, logs, fixtures, or receipts; the broad unit script discovering sibling-worktree raster suites.
- Existing plan facts: `docs/architecture/phase3-persistence-boundary.md` is authoritative; slice 1 is end to end; minimum branches and claims are Phase 3 contracts but their implementation begins in slice 2; Chrome QA and compiler-backed preview are mandatory.

## Goal Oracle

The oracle is:

`A clean synthetic store demonstrates the same typed operation through CLI and editor, one atomic durable revision, deterministic sanitized output, restart recovery, post-commit SSE refresh, and exact compiler-backed browser-native preview behavior, while adversarial stale/fault/privacy checks remain unchanged and clean.`

Planning, a service that answers requests, an SQLite schema, a CLI wrapper, or a passing reducer test alone does not satisfy this oracle.

## Goal Kind

`existing_plan`

## Current Tranche

Deliver only the architecture document's first implementation slice as one coherent vertical package. The tranche ends after a final adversarial audit proves the complete path and records `full_outcome_complete: true` for this slice. It does not claim the full Phase 3 exit gate.

## Non-Negotiable Constraints

- Work only in `codex/phase3-durable-vertical-slice` and its dedicated worktree.
- One loopback-only local service owns the store lock and every SQLite connection.
- Editor, CLI, compiler, and preview never open SQLite or persist canonical documents independently.
- Editor and CLI import one versioned command schema/client and dispatch the same typed domain operation.
- Every persistent command names an expected revision and stale or invalid writes fail atomically without event, revision, head, receipt, operation-ID consumption, or notification.
- Preserve canonical element identity independently from selectors.
- Preview refresh must fetch the committed immutable revision and render compiler output using browser-created CSS animations.
- Equal revisions produce byte-identical canonical documents, HTML/CSS, export digests, and sanitized receipts.
- Store files, WAL files, backups, discovery material, private fixtures, corpus content, screenshots, credentials, paths, URLs, and private payload receipts must not be committed.
- Use only synthetic public fixtures and temporary stores.
- Follow `docs/browser-qa-loop.md` for browser QA and include future `npm run qa:chrome` post-persistence scenarios.
- Do not implement branches, claims, merge, review, annotations, MCP, Lineage integration, video, remote service, publication, push, or PR work.
- Do not modify sibling worktrees or `lineagehq/lineage`.

## Stop Rule

Stop only when the final Judge proves the complete first-slice oracle, or when the board reaches a valid terminal approval wait. Do not stop at architecture, scaffolding, storage-only success, or a service-only milestone.

## First-Slice Shape

The largest safe package must include:

1. Shared versioned command and response schema plus generated or mechanically shared client.
2. One existing typed authoring operation addressed by canonical IDs.
3. One locked loopback service and replaceable `ProjectStore` boundary.
4. Tool-specific SQLite migration and atomic immutable revision/event/head commit.
5. Expected-revision rejection, request-digest idempotency, deterministic sanitized receipt, and restart recovery.
6. Structured CLI invocation and editor invocation from identical bases.
7. Post-commit SSE metadata, immutable refetch, and compiler-backed preview refresh.
8. Focused service, recovery, parity, browser, Chrome, privacy, and protected-diff evidence.

## Verification Truth

The existing broad `npm run test:unit` command can discover sibling-worktree `*.visual.test.ts` suites despite its exclusion and time out under concurrent Chrome raster work. The Judge must establish a main-worktree-only or exact-file nonvisual command for this goal and record the broad command's behavior honestly. Do not weaken or delete visual proof to make the broad runner green.

## Board Health

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase3-durable-vertical-slice
```

## Canonical Board

Machine truth lives at `docs/goals/phase3-durable-vertical-slice/state.yaml`.

## Run Command

```text
Codex: /goal Follow docs/goals/phase3-durable-vertical-slice/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase3-durable-vertical-slice/goal.md.
```

## PM Loop

Follow the GoalBuddy execution contract, work only the active task, preserve one active task, keep Worker writes bounded to approved files, record exact receipts, and continue until the end-to-end slice—not merely its infrastructure—is proven.
