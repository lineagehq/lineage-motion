# Landing Shot 1 Dogfood Design

## Status and claim

This document specifies a bounded dogfood experiment for the first shot of the
current Bleep landing-page CSS animation. It is a design, not implementation
authorization or evidence that the landing stress test already passes.

The user-facing claim to prove is:

> A person can open the real landing animation, focus on its first 0–2,100 ms,
> adjust one object's landed placement and the shot's internal pacing with
> direct manipulation plus precise controls, scrub and play the exact compiled
> CSS, and undo or export deterministically without breaking the following
> shot.

This is a narrow Phase 5 dogfood probe. It does not declare the Phase 4 exit
gate complete, authorize the rest of the landing stress test, or generalize the
editor into a new animation system.

## Grounded shot boundary

Shot 1 is the existing interval from loop start at `0 ms` through the stable
ready state at `2,100 ms`:

- `0 ms`: initial composition;
- `700 ms`: the focal object has landed; and
- `2,100 ms`: the result is resolved and the shot is stable.

The shot remains a view into the complete 14-second document. It is not copied,
cropped, rebased, or exported independently. Playback and the ordinary editing
surface are clipped to Shot 1, while continuity inspection may cross the
2,100 ms boundary into Shot 2.

The 2,100 ms boundary is fixed in this experiment. Landing and settling may be
retimed within it. An earlier settled moment creates a hold through 2,100 ms;
it does not shift Shot 2 or any later cue.

## Chosen interaction model

Use a shot-focused workspace over ordinary canonical motion tracks.

The workspace contains:

- the compiler-rendered stage with object selection by stable identity;
- a Pose mode for direct X/Y placement at one named moment;
- a Path mode that overlays existing named transform keyframes as draggable
  waypoints connected by their compiled trajectory segments;
- precise X/Y, scale, and rotation fields;
- landing and settled moment fields;
- one easing control for the selected temporal segment;
- temporary multi-selection with an explicit "move together" option;
- play, pause, restart, and a 0–2,100 ms scrubber; and
- a collapsed, read-only underlying-track inspection section.

The default editable moment is the named `700 ms` landed pose. A person may
select the existing start, landed, or settled moment and edit the selected
object's existing transform keyframe at that moment. Scrubbing alone never
changes the editable moment and never creates a keyframe. If the selected
object lacks one unambiguous editable transform track and exact keyframe at the
chosen moment, placement controls are disabled with a specific diagnostic.

Path mode makes geometry and time visibly separate. Each selected object's
Start, Landed, and Settled transform keyframes appear as waypoints. Dragging a
waypoint or editing its X/Y fields changes that keyframe's position. Moving the
named moment or changing its incoming easing changes when and how quickly the
browser traverses the segment. The path overlay is an editor affordance derived
from canonical tracks; it is not compiled output and never supplies preview
motion. The animated object beneath it remains compiler-rendered DOM.

For this slice, a trajectory is the ordered polyline through existing named
transform keyframes. Temporal CSS easing controls progress along each segment;
it does not create a spatial Bézier curve. Freehand paths, spatial curve
handles, `offset-path`, and adding arbitrary intermediate waypoints remain out
of scope. If the imported source contains a trajectory that cannot be
represented losslessly by the inventoried transform keyframes, editing fails
closed rather than simplifying it.

A person selects one object by clicking it or its neutral object-list entry.
Shift-click or object-list toggles create an ephemeral ordered selection set;
the most recently selected object is primary and drives the inspector. This is
not a canonical group, DOM wrapper, reusable asset, or persistent hierarchy.
With "move together" enabled, dragging the primary waypoint applies the same
stage-normalized X/Y delta to the corresponding named waypoint of every
selected object in one atomic operation. Individual paths and stable identities
remain separate. Shared landing time or easing is available only when every
selected track has the same explicitly accounted named moment and compatible
segment semantics.

Arbitrary-time keyframe insertion, object styling, content editing, DOM
restructuring, responsive variant authoring, and general track creation are not
part of this experiment.

## Source and import boundary

The actual current Bleep landing source is used only as ignored local acceptance
input. Acquisition is out of band. A local manifest binds its source digest,
capture identity, viewport, resource inventory, and acceptance configuration.
The source, local path, copy, branding, selectors, screenshots, and downloaded
resources never enter tracked files, commits, receipts, or command output.

Import inventories the entire loop before producing a document. The shot view
does not license partial import. Unsupported, missing, ambiguous, or unbound
motion remains visible and fail-closed; the importer cannot silently discard
later-shot behavior merely because the workspace shows Shot 1.

Implementation begins with a read-only preflight against the digest-locked
source. If the full-loop import requires broad landing-only support outside the
smallest first-shot slice, preflight stops for architecture review with only a
sanitized inventory and diagnostic codes. It must not reconstruct missing
motion, create a corpus-specific projection, or weaken existing fail-closed
rules to make the dogfood session proceed.

Any public synthetic fixture committed for tests reproduces only the technical
constructs needed by the operation. It uses neutral geometry, timing, labels,
and colors unrelated to the landing page.

## Shot representation

Shot 1 is ephemeral editor view state derived from an explicit, ignored,
owner-approved workspace configuration containing only the `0`, `700`, and
`2100 ms` boundaries and stable target identities. Initialization validates
those times against exact canonical keyframes and any matching canonical cues;
it never infers narrative meaning from CSS. A missing match or disagreeing cue
fails closed. The configuration is not imported, persisted, revisioned,
compiled, exported, or included in receipts. This experiment adds no `shot`
schema, runtime object, generated track owner, copied document, or separate
export identity.

The complete canonical document remains authoritative. Equal revisions still
compile to byte-identical HTML, CSS, export digests, and receipts. Stable
element IDs address edit targets; CSS selectors remain source and compiler
bindings only.

## Typed edit semantics

The editor and agent CLI use the same versioned domain operations. Every
operation names the expected document revision and the target's stable element,
track, and keyframe identity. The local service remains the sole persistent
writer.

### Pose edit

A bounded pose edit names one existing transform track, one exact keyframe, and
complete X, Y, scale, and rotation values. The reducer validates that the
existing transform can be losslessly represented by those four supported
components. Unknown transform functions, multiple competing transform tracks,
custom-property indirection that cannot be resolved without changing source
semantics, or a missing exact keyframe reject atomically.

Dragging updates an ephemeral candidate document and recompiles it through the
same compiler used for export. The preview is never directly styled or
interpolated by editor JavaScript. Pointer release submits one typed pose edit;
Escape or a failed commit discards the draft and restores the committed
revision. Numeric controls dispatch the same operation shape and reducer.

### Path and selection projection

The editor derives each visible path only from ordered canonical transform
keyframes for the selected stable element. Waypoint identity is canonical
keyframe identity. The overlay uses stage-normalized coordinates for display,
but a commit preserves the track's supported canonical transform representation
and validates the current stage geometry used for normalization. Resizing or
layout movement never silently rewrites stored waypoints.

Selecting objects and switching Pose or Path mode are local editor state and do
not create a document revision. Scrubbing is also inspection-only. The editor
keeps the selected editable moment explicit when the playhead moves so a scrub
cannot redirect the next edit to an arbitrary time.

### Atomic multi-object move

A grouped waypoint move names an ordered set of stable element, transform-track,
and corresponding keyframe IDs; their exact current bytes; the common named
moment; the stage-normalized X/Y delta; and the expected document revision. The
reducer validates every member before changing any member, applies the same
delta while preserving each object's distinct values and path, and records one
exact inverse bundle.

If any member is missing, stale, locked, unsupported, lacks the corresponding
moment, would leave the supported stage bounds, or has incompatible transform
semantics, the complete operation rejects unchanged. There is no partial group
success. Undo and redo restore or reapply every member together. Deselecting an
object changes only local selection and does not alter the committed bundle.

### Landing retime

The landing field moves only the explicitly inventoried landed-moment keyframe
group within `1..2099 ms`. All affected records are named in the operation, and
the reducer validates their exact current bytes and common source moment before
moving them. The approach easing control changes only the segment that ends at
the landed group.

The operation rejects if moving the group would cross another keyframe, split
an unaccounted synchronized group, violate steps or discrete timing semantics,
or require changing a track outside the declared bundle.

### Settled retime and hold

The settled field must remain strictly after landing and no later than
`2,100 ms`. Moving it earlier is one deterministic bundle operation:

1. validate the complete synchronized settled-moment group;
2. move that group to the requested time;
3. preserve the same settled values through the fixed 2,100 ms boundary; and
4. leave every later keyframe time unchanged.

The hold is represented by ordinary canonical keyframes and compiler timing,
not runtime waiting. The reducer rejects rather than overwrite or cross an
unaccounted keyframe within the proposed hold interval. The operation's exact
inverse restores every prior keyframe, moment, easing, ID, order, and byte.

## Preview and playback

Every committed or draft state is compiled through the production CSS compiler
and loaded into the sandboxed preview. The preview runtime discovers the
browser-created animations, pauses them, and sets their `currentTime` for the
master scrubber. Play and pause control those same native animation objects.

There is no JavaScript motion interpolator and no canvas-only approximation.
The stage may draw selection affordances, but the animated object itself is the
compiled DOM output. Reduced-motion behavior remains explicitly inspectable.

## Failure behavior

All failures preserve the committed document, revision, history, compiler
output, and preview:

- unsupported full-loop import returns inventory plus sanitized diagnostics and
  no canonical document;
- missing or ambiguous stable targets disable the control;
- an unsupported transform shape rejects with a stable error code;
- a grouped move with any ineligible member rejects the entire bundle and
  identifies only sanitized failing-member counts and codes;
- landing at or after settling, or settling after 2,100 ms, rejects;
- a retime that crosses unaccounted keyframes or breaks a synchronized group
  rejects;
- stale revisions refetch the committed head instead of leaving a draft
  pending;
- compiler or preview failure discards the candidate and restores the last
  compiled committed revision; and
- edit, undo, and redo reject atomically after conflicting intervening edits.

Diagnostics contain opaque stable identities, counts, integer times, and error
codes only. They contain no selector, source excerpt, copy, branding, geometry
payload from the real scene, or local path.

## Manual dogfood workflow

The owner and agent perform this workflow in installed Chrome:

1. open Shot 1 and confirm the untouched full-loop import receipt;
2. select the focal object by stable identity, enter Path mode, and select its
   Landed waypoint;
3. drag the waypoint, then refine X/Y numerically and confirm that its path—not
   an arbitrary scrub position—changed;
4. enter Pose mode and adjust scale or rotation at the same named moment;
5. select a second eligible object, enable move-together, and shift both Landed
   waypoints by one shared delta while preserving their separate paths;
6. make landing faster, change the approach easing, and move settling earlier
   to create a hold;
7. scrub before, at, and after each changed boundary;
8. play Shot 1 and cross 2,100 ms into Shot 2 to inspect continuity;
9. undo the grouped and individual operations to the byte-identical original
   revision, then redo exactly; and
10. export three times and confirm byte-identical output.

The session records concise observations about whether selection, placement,
timing, and recovery felt obvious. It does not record or commit screenshots or
private scene content.

## Adversarial acceptance proof

### Failure mode 1: incomplete import masquerades as an editable shot

Required evidence:

- source and canonical digests;
- complete full-loop rule, application, slot, element, track, and keyframe
  counts;
- supported, unsupported, and missing inventories;
- exact sanitized diagnostic codes;
- an assertion that any error yields no canonical document; and
- zero live network requests during import, preview, proof, and export.

### Failure mode 2: direct manipulation and exported CSS diverge

Required evidence:

- from the same baseline, direct dragging and equivalent numeric input produce
  byte-identical revision-neutral canonical content and exports;
- the preview srcdoc equals current compiler output;
- every controlled animation is browser-created `CSSAnimation` and scrubbing
  changes native `currentTime`;
- pointer release creates exactly one revision and Escape creates none; and
- undo restores exact original canonical/compiler/export digests while redo
  restores exact edited digests.

Additional trajectory evidence requires:

- every displayed path and waypoint maps to an ordered canonical transform
  track and stable keyframe identity;
- selecting, multi-selecting, switching modes, and scrubbing create zero
  revisions;
- from the same baseline, dragging one waypoint and entering equivalent X/Y
  values produce byte-identical revision-neutral canonical content and export;
- a two-object move-together commit creates one revision, changes every declared
  member by the same normalized delta, and leaves all nonmembers byte-identical;
- one ineligible or stale member causes zero changes to every member; and
- grouped undo and redo reproduce exact before and after digests.

### Failure mode 3: retiming breaks a boundary or the following shot

Required evidence:

- samples at `t-1`, `t`, and `t+1` for original and edited landing and settled
  moments;
- samples at `2099`, `2100`, and `2101 ms` plus the first later canonical cue;
- editor-preview and independently loaded export equality at every sample;
- changed-pixel containment to the declared target set and expected time span;
- unchanged later keyframe times and exact boundary accounting; and
- visible, unchanged rejection for crossing, overlap, and invalid-order cases.

### Repository and privacy proof

Before handoff, run focused and full tests, type checking, production build,
receipt validation, deterministic export checks, installed-Chrome QA, private
ignore checks, sensitive-content scans, complete diff inspection, and diff
whitespace checks. The tracked receipt may contain only versions, opaque IDs,
digests, counts, integer sample times, stable codes, boolean results, and
aggregate diff measurements.

## Exit condition

The dogfood slice is successful only when the complete manual workflow is
usable and all adversarial evidence passes. A technically editable document is
not enough if the workflow still requires understanding raw CSS percentages or
if direct placement feels less clear than editing CSS manually.

After proof, stop for owner review. Do not broaden into arbitrary keyframe
creation, sequence-wide ripple timing, responsive/mobile divergence,
pseudo-element implementation, triggers, copy overrides, full landing
authoring, publication, release, or integration work without a separately
approved goal.
