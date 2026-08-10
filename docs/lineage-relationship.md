# Relationship to Lineage

Lineage Motion is inspired by and may later integrate with
[mean-weasel/lineage](https://github.com/mean-weasel/lineage), a local-first
creative lineage workspace.

## Shared concepts

Motion deliberately learns from Lineage's contracts:

- local-first persistence with an exclusive managed writer;
- schema-versioned requests, responses, documents, and receipts;
- stable target identity instead of ambient UI state;
- optimistic revisions for exact mutations;
- bounded agent claims with heartbeat, expiry, transfer, and audit history;
- branches, review, annotations, task handoff, and human-visible agent work;
- CLI and browser convergence on shared domain functions;
- fail-closed runtime and persistence identity;
- proportional evidence before declaring work complete.

These are conceptual references, not permission to copy Lineage internals or
couple release trains during incubation.

## Different primary artifacts

Lineage's main workspace is an asset ancestry graph: assets, derived-from edges,
attempts, selections, reviews, and layouts.

Motion's main workspace is a time-addressed executable document: DOM elements,
property tracks, keyframes, cues, holds, responsive variants, reduced-motion
behavior, source bindings, and compiler receipts.

Motion therefore must not represent elements as asset nodes or build its master
timeline as a mode of the current Lineage Canvas.

## Independence rules

During incubation:

- Motion owns its database and project directory.
- Motion does not use Lineage stable, preview, or development profiles.
- Motion does not import Lineage server modules or private database schema.
- Motion has its own branch, claim, and revision records shaped for documents.
- Motion publishes no compatibility claim with a Lineage version.
- Lineage and Motion can be developed, upgraded, started, and removed
  independently.

## Future adapter

Integration begins with versioned receipts and deep links, not shared tables.

An illustrative artifact receipt is:

```ts
interface MotionArtifactReceiptV1 {
  schema_version: 'lineage.motion_artifact.v1';
  motion_project_id: string;
  document_id: string;
  branch_id: string;
  revision: number;
  document_digest: string;
  export_digest: string;
  preview_path?: string;
  export_paths: string[];
  validation: {
    status: 'passed' | 'warning' | 'failed';
    warnings: string[];
  };
  created_at: string;
}
```

Lineage could later store this receipt as a linked, reviewable creative
artifact, show branch and validation state, attach annotations or tasks, and
deep-link to the Motion editor. Editing remains owned by Motion.

The integration decision follows the landing stress test. Options include:

1. linked standalone workspace;
2. receipt import into Lineage review and handoff;
3. embedded first-party project surface with separate service/persistence;
4. shared stable domain packages; or
5. no integration if product boundaries are clearer separately.
