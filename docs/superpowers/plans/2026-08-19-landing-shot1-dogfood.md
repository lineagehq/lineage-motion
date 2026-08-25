# Landing Shot 1 Dogfood Implementation Plan

## Objective

Implement the smallest honest dogfood slice from the approved
`2026-08-18-landing-shot1-dogfood-design.md`:

- use the owner-provided landing animation only through ignored local input;
- inventory and import the complete loop without weakening fail-closed behavior;
- open the existing `0..2100 ms` interval as a focused Shot 1 workspace;
- edit existing transform trajectories through Start, Landed, and Settled
  waypoints;
- edit one object or atomically move compatible selected objects together;
- retime landing, settling, and incoming easing inside the fixed shot boundary;
- preview and scrub the compiler's browser-created CSS animations; and
- prove deterministic export, exact history, boundary safety, and sensitive
  content exclusion before manual owner QA.

The user-facing claim is that editing Shot 1 is clearer and safer than manually
coordinating CSS percentages while the exported result remains ordinary,
deterministic HTML/CSS.

## Non-goals

Do not add freehand paths, spatial Bézier handles, `offset-path`, arbitrary
keyframe insertion, permanent groups, responsive/mobile divergence,
pseudo-element support unless the preflight explicitly proves it is the single
small blocker and architecture review separately approves it, sequence-wide
ripple, copy editing, triggers, video, publication, or Lineage integration.

Do not commit the interaction mockups, private source, private manifests,
resources, screenshots, selectors, branding, copy, absolute paths, local
databases, or unsanitized receipts.

## Required order and stop gate

Task 1 is a hard gate. Run it before modifying production packages. If the
complete landing loop does not import after the already-approved offline font
materialization boundary, stop with a sanitized diagnostic receipt and return
to architecture review. Do not implement an editor against a synthetic scene
while claiming that the private dogfood target is reachable.

If Task 1 passes, perform Tasks 2–7 in order with red-green-refactor cycles.
Use one feature branch/worktree and one pull request for this slice.

## Task 1 — Private full-loop preflight

**Files**

- Add: `packages/css-import/src/landing-shot1.private.test.ts`
- Local only: `.private-corpus/landing-shot1-manifest.json`
- Local only: `.motion/receipts/landing-shot1-preflight.json`

**Test first**

Create a private acceptance test that reads a dedicated ignored manifest. The
manifest supplies the source and optional offline resource-lock locations, the
expected source digest, owner-approved workspace times `0`, `700`, and `2100`,
and stable target identities. These are explicit local configuration, not
imported or inferred semantic cues.
The test must never print or snapshot manifest contents.

The test must:

1. verify the source digest before inspection;
2. materialize only owner-provided digest-locked fonts using the existing
   resource boundary;
3. run `importMotionHtml` over the complete loop;
4. write a sanitized receipt whether import passes or fails;
5. record only importer/compiler versions, digests, counts, property/timing
   category counts, diagnostic codes, cue-presence booleans, and the closed
   transform capability categories needed by Shot 1;
6. assert that any error diagnostic produces no canonical document;
7. on success, compile three times and assert identical HTML, CSS, export
   digest, and compiler receipt; and
8. assert no surviving external URL, import, local-font lookup, script, or live
   resource reference.

Do not encode private expected rule, application, track, selector, or element
counts in tracked source. Bind those expectations inside the ignored manifest
and report only aggregate actual/expected equality.

**Run**

```bash
npx vitest run packages/css-import/src/landing-shot1.private.test.ts --sequence.concurrent false
npm run check:private-ignore
npm run check:sensitive
```

**Stop when**

- import returns no document;
- cue boundaries cannot be established without private semantic inference;
- the focal trajectories use unsupported transform composition;
- complete-loop support would require pseudo-elements, responsive variants,
  triggers, scripts, transitions, or generalized resource loading; or
- the receipt cannot remain sanitized.

The only allowed output on stop is the ignored detailed receipt plus a concise
sanitized finding for owner review.

## Task 2 — Synthetic trajectory fixture and pure projections

**Files**

- Add: `fixtures/public-synthetic/landing-shot1.html`
- Add: `packages/domain/src/trajectory.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/preview-runtime/src/index.ts`
- Add: `packages/preview-runtime/src/trajectory.test.ts`

Create a neutral two-object fixture with a `2100 ms` shot and later motion that
crosses the boundary. Use independently chosen geometry, labels, colors, and
timing. It must exercise only the sanitized transform/timing capability set
accepted by Task 1 and must not resemble the private layout or choreography.

Add pure projections with closed result types:

- `projectTransformTrajectory(document, elementId)` resolves exactly one
  continuous transform track, its application/slot/binding, ordered stable
  keyframes, absolute integer times, supported transform components, and
  eligibility codes;
- `projectShotWorkspace(document, config)` validates the explicit local
  start/landed/settled times and stable targets against exact canonical
  keyframes and any matching canonical cues, then returns eligible elements,
  waypoint identities, segment timing/easing, later continuity samples, and
  disabled reasons; and
- `projectTrajectorySelection(document, orderedElementIds, moment)` validates
  compatible waypoint and segment semantics without mutating the document.

The closed editable transform surface is the smallest grammar demonstrated by
Task 1 and the synthetic fixture. Parse it losslessly into typed translation,
scale, and rotation components. Reject unknown functions, multiple competing
transform tracks, shared rules whose edit would affect undeclared elements,
custom-property indirection, mixed incompatible units, non-finite values, or
ambiguous keyframe identity. Do not normalize unsupported CSS into an editable
approximation.

Represent stage geometry for editor conversion as integer microunits plus a
canonical digest. Represent normalized positions and deltas as integer
parts-per-million. No operation or receipt stores live DOM rectangles.

**Tests**

- selectors do not participate in selection or waypoint identity;
- Start/Landed/Settled resolve to exact existing stable keyframe IDs;
- projection order is canonical and independent of input selection order;
- supported transform strings round-trip deterministically;
- every unsupported grammar fails with a stable code;
- scrub position never changes the selected editable moment; and
- the `2100/2101 ms` continuity projection includes later tracks unchanged.

**Run**

```bash
npx vitest run packages/domain/src/trajectory.test.ts packages/preview-runtime/src/trajectory.test.ts
npm run typecheck
```

## Task 3 — Atomic typed trajectory operations and exact history

**Files**

- Modify: `packages/domain/src/index.ts`
- Add: `packages/domain/src/trajectory-authoring.test.ts`
- Modify: `packages/domain/src/authoring.test.ts`
- Modify: `packages/css-compiler/src/determinism.test.ts`

Extend `AuthoringOperation` and the single reducer with these version-1
operations. Keep payloads strict and exact; reject extra keys.

### `motion.transform-pose.set`

Name one stable element, transform track, and existing keyframe. Supply the
expected current transform bytes, complete supported next pose, and the stage
projection record used by the editor. Apply no implicit keyframe creation.

### `motion.transform-waypoints.translate`

Name a canonically ordered nonempty target bundle. Each member names stable
element/track/keyframe identity and exact current transform bytes. Supply one
integer X/Y ppm delta and its stage projection. Validate every member first,
then apply the same resolved delta atomically while preserving distinct scale,
rotation, IDs, order, and paths.

### `motion.keyframe-group-time.set`

Name the complete compatible keyframe group at one existing source moment and
the requested integer target time. Require `start < landing < settled <= 2100`,
preserve every later time, and reject collision, crossing, incomplete shared
rules, discrete/steps incompatibility, or unaccounted synchronized tracks.

### `motion.keyframe-group-easing.set`

Name the complete incoming segment group and set one supported temporal easing.
Reject mixed or unsupported segment semantics.

### `motion.settled-hold.set`

Name the complete settled group and fixed `2100 ms` shot boundary. Move settling
earlier and deterministically install or update boundary anchors with IDs
derived from track identity and boundary time. Reject existing unaccounted
keyframes in the hold interval. Never move a later keyframe.

Every operation must:

- validate document, revision, operation ID, complete target bytes, and all
  bounds before allocation;
- produce one revision or zero;
- record an exact forward/inverse bundle containing all prior canonical records;
- use the existing history reducer for undo/redo;
- leave all nonmembers byte-identical; and
- validate the complete candidate document before returning success.

**Adversarial tests**

- direct pose and equivalent single-waypoint translation converge to equal
  revision-neutral content and export;
- two eligible members move by one equal delta in one revision;
- missing, duplicate, stale, locked, mixed-unit, shared-rule, out-of-bounds, or
  incompatible members cause zero changes to every member;
- landing/settled ordering and the fixed boundary reject invalid requests;
- hold insertion preserves later keyframe times and compiler bytes outside the
  declared interval;
- undo reproduces original canonical/compiler/export digests and redo
  reproduces edited digests; and
- corrupted history replay fails unchanged.

**Run**

```bash
npx vitest run packages/domain/src/trajectory.test.ts packages/domain/src/trajectory-authoring.test.ts packages/domain/src/authoring.test.ts --sequence.concurrent false
npm run verify:determinism
npm run typecheck
```

## Task 4 — Shared protocol, service, claims, and CLI parity

**Files**

- Modify: `packages/motion-protocol/src/index.ts`
- Modify: `packages/motion-protocol/src/index.test.ts`
- Modify: `packages/local-service/src/sqlite-project-store.ts`
- Modify: `packages/local-service/src/service.test.ts`
- Modify: `packages/local-service/src/recovery.test.ts`
- Modify: `packages/motion-cli/src/cli.ts`
- Modify: `packages/motion-cli/src/cli.test.ts`
- Modify: `packages/phase3-proof/src/parity.test.ts`

Add strict Zod wire schemas and factories for all five trajectory operations.
The protocol schema must reuse the domain's closed IDs, integer ranges, easing
set, target-bundle shape, and operation-ID validation rather than describe a
wider language.

Generalize the store's authoring discriminator from only
`motion.track.create` to the closed authoring-operation union. All operations
continue through `dispatchAuthoringOperation`, branch-head compare-and-swap,
agent claim enforcement, immutable revision persistence, event publication,
idempotent replay, sanitized receipts, and recovery verification. Do not add a
second reducer or persistence table.

Add CLI commands:

- `pose-set`;
- `waypoints-translate` using a path to a local operation JSON bundle rather
  than an unbounded list of shell flags;
- `moment-time-set`;
- `segment-easing-set`; and
- `settled-hold-set`.

The CLI bundle file is local private input, is never echoed, and is parsed by
the same strict protocol schema. Stdout remains a sanitized canonical response.

**Tests**

- editor factories and CLI construct byte-identical commands for equal input;
- protocol rejects extra fields, fractional ppm/microunits, duplicate or
  unsorted members, malformed transforms, and domain-impossible values;
- one service commit creates one immutable revision and one event;
- simultaneous clients produce one success and one unchanged stale failure;
- agent writes require an active overlapping claim;
- retry with the same operation/private context replays identically;
- fault injection leaves every table unchanged; and
- restart restores the exact edited head and history-independent compiler
  digest.

**Run**

```bash
npm run test:phase3:service
npm run test:phase3:recovery
npm run test:phase3:parity
npm run typecheck
```

## Task 5 — Shot workspace, Path mode, and draft behavior

**Files**

- Modify: `apps/editor/src/main.ts`
- Modify: `apps/editor/src/global.d.ts`
- Modify: `apps/editor/src/styles.css`
- Modify: `apps/editor/tests/editor.spec.ts`
- Modify: `apps/editor/tests/phase3.spec.ts`
- Modify: `apps/editor/scripts/qa-chrome.mjs`

Build the approved neutral workspace inside the existing editor without adding
a framework or alternate app:

- Shot 1 header with the fixed `0..2100 ms` range and continuity affordance;
- stable-identity object list and compiler-DOM click selection;
- explicit Pose and Path modes;
- selected object paths derived from `projectTransformTrajectory`;
- Start/Landed/Settled waypoint handles whose identity is visible on demand;
- X/Y, scale, rotation, moment time, and incoming easing fields;
- temporary ordered multi-selection and an explicit move-together checkbox;
- play, pause, restart, and master scrubber; and
- collapsed read-only canonical track inspection.

Expose one strict generic `openShotWorkspace(config)` test/host boundary on the
existing editor API. The config contains integer start/landed/end times and
stable target IDs only. The ignored local harness supplies it after the private
service head loads. Opening or closing the workspace creates no revision and
does not persist, compile, export, or include the config in a receipt. Reject
extra fields, missing keyframe matches, disagreeing canonical cues, unknown
targets, or an interval outside the document duration.

The overlay lives above the iframe and never replaces the compiled animated
elements. Convert iframe element and waypoint geometry to overlay coordinates
using the iframe/stage rectangles only for presentation and operation building.
Do not write into the iframe DOM or styles.

Dragging creates an ephemeral candidate by sending the exact operation through
the domain reducer against a clone of the committed head, recompiling the
candidate, and remounting compiler output. Pointer release sends that same
operation through `MotionServiceClient`. Escape cancels and remounts committed
output. Numeric fields use the identical operation builder. Selecting,
multi-selecting, changing modes, and scrubbing create no revision.

On stale/service/compiler failure, discard the candidate, refetch branch head,
recompile, and show the stable diagnostic without leaving a pending draft.

**Browser tests**

- click and keyboard selection use stable IDs and preserve native tab order;
- Path mode maps every handle to one canonical keyframe;
- dragging and numeric entry from the same baseline converge to equal content;
- pointer release creates one revision; Escape creates zero;
- selected-moment identity does not follow the scrubber;
- two selected objects move together in one operation while nonmembers do not;
- invalid/ineligible grouping is visibly disabled or rejects unchanged;
- preview `srcdoc` equals compiler HTML after draft, commit, undo, and redo;
- all controlled animations are native `CSSAnimation` objects;
- play, pause, and scrub work at `0`, landing, settling, `2099`, `2100`, and
  `2101 ms`;
- reduced motion remains inspectable; and
- 1440, 768, and 360 pixel layouts have no page-level horizontal overflow,
  clipped controls, lost focus, or console errors.

**Run**

```bash
npm run test:browser
npm run test:phase3:browser
npm run qa:chrome
npm run typecheck
npm run build
```

## Task 6 — Deterministic trajectory visual proof

**Files**

- Add: `packages/visual-proof/src/trajectory-authoring.visual.test.ts`
- Modify: `packages/visual-proof/src/index.ts` only if a generic sampling or
  containment helper is missing
- Modify: `package.json`
- Do not modify: `package-lock.json`; add no dependency

Add `test:visual:trajectory` and a neutral synthetic controlled-Chromium proof.
Use independent browser contexts, existing DOM/font/layout/semantic/raster
convergence, compiler output, and native animation `currentTime` control.

Prove these states:

- `S0` original;
- `S1` single Landed waypoint moved;
- `S2` equivalent numeric move;
- `S3` two-object grouped move;
- `S4` landing retime and easing;
- `S5` early settling plus fixed-boundary hold;
- `U` exact undo sequence back to `S0`; and
- `R` exact redo sequence back to `S5`.

Derive samples from every affected segment and include `t-1/t/t+1` around
original and edited landing and settling, `2099/2100/2101`, and the first later
cue. Compare editor preview against an independently loaded export. Require
exact equality for content-identical states and changed-pixel containment to
the declared target elements and time spans for edited states.

The sanitized tracked receipt records only versions, environment, opaque state
labels, digests, counts, integer sample times, convergence counts, containment
booleans, aggregate changed pixels/channel delta, diagnostic codes, and pass
status. Screenshots and detailed geometry remain ignored.

**Run**

```bash
npm run test:visual:trajectory
npm run verify:determinism
npm run verify:receipts
```

Run the trajectory proof three consecutive times. All three receipts and export
digests must agree.

## Task 7 — Private acceptance and manual installed-Chrome dogfood

**Files**

- Extend: `packages/css-import/src/landing-shot1.private.test.ts`
- Add: `packages/visual-proof/src/landing-shot1.private.test.ts`
- Modify: `apps/editor/scripts/qa-chrome.mjs`
- Modify: `package.json` so `test:private-acceptance` includes both landing
  private tests
- Add tracked sanitized receipt only under the eventual GoalBuddy goal's
  `notes/` directory; keep detailed artifacts under `.motion/` and `artifacts/`

Against the digest-locked private document, resolve targets only through ignored
acceptance configuration containing stable canonical IDs and expected current
bytes. Product code and tracked tests must not hardcode private identities.

Automate the complete workflow in installed Chrome, then repeat it manually
with the owner watching:

1. confirm complete-loop inventory and untouched export digest;
2. select the focal object and Landed waypoint;
3. drag and refine X/Y;
4. adjust Pose scale or rotation;
5. select a second eligible object and move together;
6. retime landing/easing and create the early-settle hold;
7. scrub every derived boundary and cross into Shot 2;
8. undo to exact original and redo to exact edited state; and
9. export three byte-identical results.

Require zero live network, zero failed requests, zero console errors, exact
compiler/native-preview correspondence, exact history digests, and no changes
outside the declared target/time containment.

If the real scene has only one eligible trajectory, prove individual editing
and report `GROUP_DOGFOOD_TARGET_UNAVAILABLE`; do not invent a second private
target or claim private grouped proof. The synthetic grouped proof remains
required.

**Run**

```bash
npx vitest run packages/css-import/src/landing-shot1.private.test.ts packages/visual-proof/src/landing-shot1.private.test.ts --sequence.concurrent false
npm run qa:chrome
npm run check:private-ignore
npm run check:sensitive
```

## Final adversarial verification

Run from a clean worktree with the ignored private manifest present:

```bash
npm run test:unit
npm run verify:determinism
npm run test:visual
npm run test:visual:authoring
npm run test:visual:trajectory
npm run test:private-acceptance
npm run test:phase3:service
npm run test:phase3:recovery
npm run test:phase3:parity
npm run test:browser
npm run test:phase3:browser
npm run qa:chrome
npm run verify:receipts
npm run typecheck
npm run build
npm run check:private-ignore
npm run check:sensitive
git diff --check
git status --short
```

Inspect the complete branch diff and tracked inventory for private source,
paths, selectors, copy, branding, screenshots, resources, credentials, URLs,
SQLite files, and unrelated phase work.

Before claiming completion, state the owner-facing claim and present exact
evidence for the top three realistic failures:

1. incomplete full-loop import;
2. path/direct-manipulation divergence from compiled CSS; and
3. grouped or retimed edits damaging boundaries, nonmembers, or Shot 2.

Stop for owner manual QA and architecture review after this proof. Do not begin
the rest of the landing stress test automatically.
