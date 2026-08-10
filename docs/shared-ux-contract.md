# Shared Human and Agent UX Contract

## Purpose

Lineage Motion is not an editor with an AI chat box attached. Humans and agents
are peers operating one motion document through one operation language.

The visual editor, CLI, and future MCP tools must converge on the same domain
service. A human gesture and an agent command that express the same change must
produce the same canonical document digest.

## Invariants

### One state

There is one canonical motion document per branch head. Browser and CLI clients
do not maintain independent authoritative copies.

### One operation language

Every committed editor gesture emits a typed operation. Operations can be
copied, replayed, reviewed, compared, branched, and issued through the CLI.

Initial vocabulary:

```text
document.import
document.replaceCopy
keyframe.setValue
keyframe.setEasing
keyframe.move
range.retime
range.insertHold
cue.create
cue.move
track.setTiming
track.setVisibility
branch.create
branch.applyOperations
document.validate
document.export
```

Natural-language intent is translated into these operations. Stored history
contains the structured operation and result, not only the prompt.

### One writer

Once persistence exists, a local service is the sole writer. Editor, CLI, and
future MCP clients call it; they do not write JSON, CSS, or SQLite directly.

### Optimistic revisions

Every mutation names the revision it observed. A stale operation fails without
partial mutation and returns the current revision plus focused conflict data.

### Bounded agent claims

Agent mutations require a claim scoped to an exact document and branch. Claims
have heartbeat, expiry, release, transfer, and audited operation receipts.
Human users can see active claims and explicitly override or transfer them.

### Legible work

The editor makes branch, revision, claim, unsupported-source, validation, and
export state visible without overwhelming the timeline. Collaboration state is
quiet until relevant.

## Operation envelope

An illustrative contract is:

```ts
interface MotionOperationEnvelope {
  schema_version: 'motion.operation.v1';
  operation_id: string;
  project_id: string;
  document_id: string;
  branch_id: string;
  expected_revision: number;
  actor: {
    kind: 'human' | 'agent';
    id: string;
    label: string;
  };
  claim_token?: string;
  operation: MotionOperation;
}
```

Successful responses include the old and new revision, affected
elements/tracks/cues, validation warnings, and canonical document digest.

## Human editor

The editor coordinates three regions:

1. A sandboxed live DOM preview with bidirectional element selection and inline
   copy editing.
2. A hierarchical master timeline grouped by element and property, with cues,
   keyframes, holds, discrete states, multi-select, snapping, and a global
   playhead.
3. An inspector/activity surface for values, easing, source bindings,
   diagnostics, branches, claims, history, annotations, and export proof.

Every multi-track edit must state whether it ripples later cues, compresses a
range, or creates collisions. Preview the affected range before commit.

## Agent and CLI

Agents discover stable IDs and available operations before mutating. Commands
accept document, branch, element, track, cue, and keyframe IDs—not guessed CSS
selectors.

Representative flow:

```text
motion inspect --document <id> --json
motion tracks list --document <id> --json
motion branch create --document <id> --name longer-reveal --json
motion claim --document <id> --branch longer-reveal --agent-name Codex --json
motion range insert-hold --from-cue typing-complete --duration-ms 600 --expected-revision 3 --json
motion validate --document <id> --branch longer-reveal --json
motion export --document <id> --branch longer-reveal --format html-css --json
```

MCP should be a thin wrapper over this service protocol after the CLI and
operation schemas are stable.

## Branch and review semantics

- A branch points to an immutable document revision and advances through
  operations.
- Review compares operations, cue timing, copy, validation, and visual frames.
- Initial merge is explicit replay or cherry-pick of operations.
- Conflicts name the affected element, track, keyframe, or cue and require a
  human choice.
- Automatic structural merge is deferred until real concurrency evidence
  justifies it.

## Accessibility

Keyboard users must be able to select, move, and edit cues and keyframes with
announced timing changes. Reduced-motion output is an authored, inspectable
variant or snapshot—not a blanket animation kill switch inferred at export.
