# Pinned shots and sequence playback

A sequence is an ordered list of shot occurrences in one fixed viewport. Each
occurrence has its own stable clip ID, name and end hold, and references an exact
shot document ID, revision, canonical digest and duration. Changing a shot head
does not update a sequence implicitly. Updating an occurrence's reference is an
explicit operation; duplicate occurrences can be updated independently.

Reordering changes the occurrence's start time without changing shot-local time.
An end hold freezes the native state at the source duration. Intervals are
half-open: at a cut, the next shot owns the frame. At and beyond the total
duration, the last shot retains its native endpoint, including CSS fill behavior.
Reduced motion uses each source's reduced stylesheet with the same hard cuts.

The composition compiler embeds unchanged compiled shots in separate scriptless
iframe documents. A generated outer controller advances browser-native CSS
animations from one clock; it does not interpolate CSS property values. Preview
and standalone output use the same generated artifact. Source selectors,
keyframe names, IDs and fonts remain isolated by their document boundaries.
Playback waits for embedded frames, fonts and images and reports readiness
failure visibly. Infinite, authored-paused or unsupported animation sources
cannot be committed; source discovery reports their restriction explicitly.

Viewport certification is deliberately conservative. The service recognizes
fixed pixel root dimensions or a fixed stage under percentage-sized roots,
requires clipping and rejects conflicting or ambiguous boundary geometry. The
included trajectory starter is 800×450; the interaction starter is 640×360.
They require separate sequences unless a compatible source is imported.

The local service owns sequence persistence, immutable revisions, history and
claims. Every command has an operation ID and expected sequence revision. Agent
writes require a sequence-specific claim; document claims confer no sequence
authority. Human edits must explicitly revoke an active agent claim first.
Retries with the same request and private identity return the original receipt.
Migration 6 adds separate tables and preserves existing shot storage and backups.

The shared typed contract is in `packages/motion-protocol/src/sequence.ts`.
Authenticated routes are under `/api/sequence/v1`: `GET catalog`, `GET sources`,
`GET sequences/:id`, `POST commands`, and `POST export`. Commands cover creation,
renaming, add/duplicate/remove/reorder, occurrence names and holds, explicit source
updates, undo/redo and claim acquire/renew/release/revoke. Export requires the
project, sequence ID and exact expected revision. Empty sequences are editable
but cannot be played or exported.

The generated `window.__motionSequence` controller exposes `ready`, `seek(ms)`,
`play()`, `pause()` and `readState()`. Seeking pauses playback and clamps to the
sequence range. Play restarts at zero after the final endpoint. This interface
is generated product code; imported scripts remain prohibited.
