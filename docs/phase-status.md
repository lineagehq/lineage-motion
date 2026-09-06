# Phase status and scope

This is the current scope index, updated 2026-09-06 from the merged repository
at `d289bfc`. Use the active request and existing authorization for maintenance
of implemented behavior. Consult this index when expanding capabilities, and
update it with a decision and evidence link when scope or gate acceptance changes.
The [incubation plan](incubation-plan.md) remains the roadmap.

## Implemented scope and evidence

| Scope | Repository evidence | Gate status recorded here |
| --- | --- | --- |
| Import, canonical documents, compiled preview, export, and visual proof | `packages/css-import`, `packages/css-compiler`, `packages/visual-proof`; [visual receipt](evidence/t005-visual-proof.json) | Existing implementation and historical proof; this index does not newly accept the Phase 0/1 gates. |
| Human authoring, track/target selection, holds, and ripple retiming | [authoring receipt](evidence/t002-phase2-authoring.json), [hold/ripple receipt](evidence/t002-phase2-hold-ripple.json), [track receipt](evidence/t002-phase2-track-creation.json) | Existing implementation and historical proof; this index does not newly accept the Phase 2 gate. |
| Sole-writer service, SQLite, revisions, branches, claims, CLI/editor parity | `packages/local-service`, `packages/motion-cli`; [Phase 3 aggregate](evidence/t002-phase3-aggregate.json), [human/agent dogfood](evidence/t009-human-agent-dogfood.json) | Aggregate receipt records `passed: true`; historical technical proof is not a new owner-acceptance decision or proof of the current commit. |
| Coach-mark cues, five-scene import, annotations, review, and handoff | [Phase 4 architecture](architecture/phase4-coach-mark-breadth.md), `packages/css-import/src/five-scene.ts`, `packages/review-domain`, `apps/editor/tests/phase4-reusable-cues.spec.ts` | Implemented breadth; no complete Phase 4 exit-gate acceptance is asserted by this index. |
| Landing-shot import and workspace work | `packages/css-import/src/landing-shot1.private.test.ts`, `apps/editor/src/editor-shot-workspace.ts` | Existing slice, not blanket authorization or acceptance of the full Phase 5 stress test. |

## Decision boundary

The repository has progressed beyond its initial Phase 0/read-only Phase 1
package. Fixing existing persistence, branch, claim, or landing behavior within
a user's request does not require reauthorizing its historical implementation.

Implementation, passing evidence, and owner acceptance are distinct. The linked
receipts record technical results at their original revisions. Where this index
has no explicit accepted-gate decision, do not infer one from a filename, code
presence, or historical receipt. New phase scope requires authorization from
the active request or an existing explicit decision; reuse authorization already
given instead of asking again. Record that decision here when it changes scope.

MCP, package publication, video export, and Lineage integration remain outside
the default scope. The standalone repository and private-data boundaries in
[AGENTS.md](../AGENTS.md) continue to apply.
