# Canvas-First UX Polish Design

## Purpose

Make the motion editor easier to understand and use without weakening its
durable human–agent contract. A person should be able to perform the common CSS
animation workflow directly around the canvas, while exact values, diagnostics,
collaboration details, and complete track inspection remain available on demand.

This is a presentation and interaction-hierarchy pass. It does not add animation
semantics or change the canonical motion document.

## User-facing claim

A first-time user can select an object and moment, move, scale, or rotate it,
adjust when and how it moves, add another moment, play the animation, and undo or
redo without leaving the canvas or opening technical controls.

## Approved layout

The canvas is the visual center of the editor.

### Floating object bar

A compact bar floats above the canvas and contains:

- the object selector;
- `Path` visibility;
- `Edit together` when grouped editing is eligible.

The bar stays close to the edited content but must not overlap transform handles
or destination labels. Object selection remains based on stable element identity,
not CSS selectors.

### Combined moments and playback rail

A single rail below the canvas contains:

- Play and Pause;
- Start, intermediate points, and Settle in chronological order;
- add-point controls between eligible moments;
- the current preview time and scrubber.

The rail is the primary temporal map. Moment names are authoritative and are
shared with destination outlines: `Start`, `Point 1`, `Point 2`, and `Settle`.
Milliseconds are secondary information.

### Contextual moment dock

Selecting a moment scrubs the browser-created CSS animations to that exact time
and opens a compact dock immediately above the rail. The dock contains only:

- the selected moment name;
- its time;
- the movement/easing preset following that moment;
- `Remove point` when the selected point is removable;
- an `Advanced` entry point.

Start and Settle remain protected. Selecting an object with a different waypoint
inventory recomputes moment names and dock contents from that object's canonical
trajectory.

### Advanced overlay drawer

Advanced opens as a right-side overlay. It must not resize, translate, scale, or
otherwise remap the canvas. Closing it restores the unobstructed view without
changing selection or preview time.

The drawer groups technical controls by purpose and keeps groups collapsed unless
the user opens them:

1. Exact pose: X, Y, scale, and rotation.
2. Timing details: exact moment and settled-hold controls.
3. Collaboration: branch, revision, actor, claim, and activity.
4. Diagnostics and inspection: operation diagnostics, complete tracks, cues,
   keyframes, stable IDs, and reduced-motion inspection.

The drawer may obscure the right edge while open, but the underlying canvas
coordinate system and object geometry must remain fixed.

## Interaction model

The selected object, selected moment, and native preview time always agree.

1. Selecting an object highlights only that object and its editable trajectory.
2. Selecting a moment highlights its rail chip, destination outline, relevant
   path segment, and context dock, then aligns the native preview to its time.
3. Dragging an object or destination, dragging a scale corner, or dragging the
   rotation handle presents a smooth temporary preview and commits once on
   release through the existing typed operation path.
4. Adding a point selects it immediately and deterministically renumbers later
   intermediate points.
5. `Edit together` makes the affected object scope explicit before the user acts.
6. Play, Pause, scrub, Undo, and Redo retain the current browser-native and
   durable-service behavior.

No interaction may introduce a second interpolation engine. The iframe continues
to render compiler output, and scrubbing continues to control browser-created
animations.

## Feedback and failure behavior

Pending publication uses a quiet progress treatment on the affected control and
temporarily prevents another persistent command. It does not display an
uncommitted durable revision as settled.

On failure:

- preserve the previous canonical document, compiler output, iframe, selection,
  and preview time;
- show a plain-language message next to the affected control;
- keep the sanitized technical diagnostic available in Advanced;
- retain the user's recoverable draft when the existing workflow supports it;
- never retry from a different revision invisibly.

The UI must not jump after pointer release. Opening or closing the drawer, dock,
or path display must not change the canvas mapping.

## Keyboard and accessibility behavior

Every action available through pointer input remains keyboard reachable.

- Object and moment controls use native button, radio, checkbox, range, select,
  or disclosure semantics as appropriate.
- Destination outlines and transform handles retain descriptive accessible names
  and at least 44-pixel effective hit areas.
- Focus moves to a newly inserted point and returns predictably after removal.
- Errors are announced without moving focus unless the user must correct a
  specific invalid field.
- Focus order follows object selection, canvas editing, moment rail, context dock,
  Advanced, and history controls.

## Responsive behavior

Desktop is the primary authoring surface. At narrow widths, the object bar and
moments rail may wrap or scroll without shrinking the stage below a usable size.
The Advanced overlay may adapt to a bottom sheet on narrow screens, but this is a
responsive presentation of the same controls, not a distinct workflow.

## Implementation boundaries

Prefer reorganizing editor markup and styles while reusing existing event
handlers, projections, service calls, and typed operations. Small ephemeral UI
state is allowed for dock and drawer visibility.

Do not add:

- new canonical animation or shot entities;
- new operation kinds or CLI commands;
- new persistence, branches, claims, or service writers;
- JavaScript interpolation or a separate preview representation;
- free-form CSS editing;
- landing-animation implementation or additional animation examples;
- private fixtures, copy, branding, screenshots, paths, credentials, or data.

## Acceptance proof

The implementation is complete only when all of the following are directly
demonstrated:

1. From a fresh named-subdomain session, a first-time workflow can select an
   object and moment, add a point, move, scale, rotate, retime, change movement,
   play, pause, scrub, undo, and redo without opening Advanced.
2. The same workflow succeeds with keyboard activation and predictable focus.
3. Canvas, stage, object, and destination geometry are identical before, during,
   and after opening Advanced, within one CSS pixel.
4. Object, moment, destination, path, dock, scrubber, and native preview selection
   remain synchronized across object switches and asymmetric waypoint inventories.
5. Pointer release commits once without flicker, snap-back, or placement drift.
6. Failed and stale operations preserve the prior coherent compiler-native view
   and expose plain-language plus sanitized technical feedback.
7. Equal revisions retain byte-identical compiler output and receipts; existing
   human/CLI operation parity remains unchanged.
8. Browser QA confirms all iframe animations are browser-created CSS animations
   and reduced-motion behavior remains inspectable.
9. Focused editor tests, the durable service/recovery/parity suites, deterministic
   export tests, visual proof, typecheck, production build, diff check, sensitive
   scan, and private-ignore check pass.

## Top realistic failure modes

1. Simplification hides a required action or makes grouping scope ambiguous.
2. The overlay drawer or responsive layout changes the canvas coordinate mapping,
   causing drag or destination placement drift.
3. New presentation state becomes a second source of truth and diverges from the
   canonical document, durable service, CLI, or compiler preview.

These risks must be tested explicitly rather than inferred from visual polish.
