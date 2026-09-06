# Projects and shots

Start the local editor with `npm run dev:editor -- --project "My animation"`.
Open the printed address. Reuse the same project name, checkout and data directory
to reopen your saved work. To work on another project, stop the launcher and
start it with that project's name, or run a second launcher on a different port.
`--port 0` selects an available port and keeps that address through development
configuration reloads. Existing projects keep their stored identity and receipts.

In **Create a shot**, name your shot and choose **Moving objects starter**,
**Interaction starter**, or **Import HTML and CSS**. Import accepts a complete,
self-contained HTML scene with inline CSS. Unsupported content is rejected before
saving; the editor shows the diagnostic and inventory when available. The input
stays in the form so it can be corrected. Imported copy and labels are displayed
as text, not executable editor markup.

**Current shot** opens the selected shot's saved main branch. Each shot opens in
a fresh page, with its own selection, history, subscriptions and preview. A
missing shot address reports an error instead of substituting the first shot.
When a shot has an unapplied draft, choose **Stay here** or **Discard changes and
switch**. Wait for an in-flight change to finish before switching. No pending
mutation is moved to another shot.

Choose an object by its readable label, then choose an available action:
**Move**, **Fade**, **Reveal**, **Type**, **Hold selected object**, **Click**,
**Select**, or **Drag**. Availability comes from the loaded document. Disabled
actions explain their restriction. Start and Complete use whole milliseconds;
movement coordinates use percentages of the scene. Actions involving two objects
offer an eligible second object when one exists.

**Created actions** supports Edit, Detach and Delete through the same typed
operations used by agents. Editing retains additional roles and intermediate
geometry; changing the time span proportionally retimes intermediate beats.
Detach keeps the generated motion while removing semantic ownership. Delete
removes the action using the domain's existing replacement semantics. Undo and
Redo remain available. An action draft made against an older revision must be
discarded and reconsidered after another editor changes the shot.

The detailed opacity controls below the action panel edit independently created
Fade tracks. Add midpoint uses that track's actual timing; an odd millisecond
duration must be made even before an exact half-duration keyframe is available.
Cue-owned motion is edited through **Created actions**.

**Pause the whole shot** is different from **Hold selected object**. A whole-shot
pause uses an existing supported source cue, freezes active source animations,
and shifts later cues and the shot duration together. It requires finite,
forward, running animations and currently cannot be combined with attached
semantic actions. Imported HTML has no source cue markers; use an eligible
selected-object hold at a source keyframe, or a starter with source cues. The
editor explains this restriction rather than inventing a boundary.

The preview continues to render compiler output through browser-created CSS
animations. Play, Pause, the time scrubber and the reduced-motion inspection
remain available in the editor. General drawing, free-form CSS editing, sequence
composition is a separate capability. See [standalone export](standalone-export.md) to download a saved shot.
