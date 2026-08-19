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

- the compiler-rendered stage with one selected object;
- direct dragging for X/Y placement;
- precise X/Y, scale, and rotation fields;
- landing and settled moment fields;
- one easing control for the approach segment ending at the landed moment;
- play, pause, restart, and a 0–2,100 ms scrubber; and
- a collapsed, read-only underlying-track inspection section.

The default editable moment is the named `700 ms` landed pose. A person may
select the existing start, landed, or settled moment and edit the selected
object's existing transform keyframe at that moment. Scrubbing alone never
changes the editable moment and never creates a keyframe. If the selected
object lacks one unambiguous editable transform track and exact keyframe at the
chosen moment, placement controls are disabled with a specific diagnostic.

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

Shot 1 is ephemeral editor view state derived from the existing canonical cue
times. This experiment adds no `shot` schema, runtime object, generated track
owner, copied document, or separate export identity.

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
2. select the focal object by stable identity and select its landed moment;
3. drag the object, then refine X/Y numerically;
4. adjust scale or rotation;
5. make landing faster, change the approach easing, and move settling earlier
   to create a hold;
6. scrub before, at, and after each changed boundary;
7. play Shot 1 and cross 2,100 ms into Shot 2 to inspect continuity;
8. undo to the byte-identical original revision and redo exactly; and
9. export three times and confirm byte-identical output.

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
