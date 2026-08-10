# Phase 0 and Read-Only Phase 1 Design

## Purpose

Build the smallest credible standalone slice that imports one private,
self-contained HTML/CSS motion scene, represents its complete choreography,
compiles deterministic pure HTML/CSS, previews and scrubs the browser-created
animations, and proves visual equivalence. Stop for architecture review before
adding editing, persistence, collaboration, or Lineage integration.

The controlled proof environment is the Playwright-managed Chromium revision
locked by the repository dependency graph. Cross-browser proof is deferred.

## Scope

This slice completes Phase 0 and only the read-only portion of Phase 1 from
`docs/incubation-plan.md`.

It includes:

- repository and private-corpus safety controls;
- public synthetic fixtures for the motion constructs used by the slice;
- schema-versioned motion-domain types and validation;
- fail-closed HTML/CSS inventory and import;
- deterministic pure HTML/CSS compilation;
- a sandboxed live DOM preview using browser-owned animations;
- a minimal read-only master timeline;
- deterministic Chromium capture and pixel comparison;
- sanitized evidence and compiler receipts.

It excludes:

- mutation operations or an authoring UI;
- persistence, a database, or a sole-writer service;
- a CLI, MCP, branches, claims, annotations, or review workflow;
- React or Tailwind round-tripping;
- the later landing-animation stress test;
- package publication, release, push, or pull request creation;
- any private fixture, source, copy, branding, screenshot, path, database, or
  credential in tracked repository content.

## Chosen approach

Use structural HTML and CSS parsers to import a deliberately narrow supported
surface. Keep non-motion presentation HTML and CSS as opaque document payloads,
but represent every motion declaration structurally. This avoids creating a
second general-purpose CSS language while retaining the data needed for future
animation authoring.

Browser CSSOM import is rejected because browser normalization hides source
constructs that must produce fail-closed diagnostics. Regex import is rejected
because it cannot credibly parse comma-separated animation slots, nested CSS
functions, and keyframe blocks.

## Repository boundaries

Create only the boundaries needed by this slice:

```text
apps/
  editor/                 read-only timeline and sandboxed preview shell
packages/
  domain/                 schema, validation, canonical JSON, stable IDs
  css-import/             HTML/CSS inventory and canonical import
  css-compiler/           deterministic pure HTML/CSS and compiler receipt
  preview-runtime/        iframe loading and browser animation controls
  visual-proof/           readiness, capture, comparison, proof receipt
fixtures/
  public-synthetic/       public scenes containing only synthetic content
```

Use npm workspaces, TypeScript, Vitest, Vite, PostCSS, parse5, and Playwright.
Use a focused image-diff library for raw pixel comparison. Do not create the
future service, store, CLI, adapter, or operation packages.

## Canonical motion document

`motion.document.v1` is deterministic JSON with these conceptual sections:

- document identity, schema version, revision `0`, and integer duration in
  milliseconds;
- presentation HTML and non-motion CSS required to reproduce the static scene;
- elements with stable canonical IDs, selector hints, structural source
  fingerprints, and optional editable text;
- animation rules with stable IDs and ordered property tracks;
- eight ordered animation applications, each with one or more ordered slots;
- application slots containing rule reference, duration, delay, iteration
  count, direction, fill mode, play state, and timing function;
- property tracks containing element reference, rule reference, property name,
  interpolation classification, and ordered keyframes;
- keyframes with stable IDs, integer time, normalized offset, lossless CSS
  value, optional segment easing, and discrete or step metadata;
- source binding and import inventory containing digests and sanitized counts;
- reduced-motion metadata retained as an inspectable snapshot contract, with no
  editing surface in this phase.

The first private scene must produce exactly nine rule records and eight
application records. One application contains two simultaneous slots. The
document must preserve staggered delays and both step-timed slots.

### Stable identity

Canonical element IDs are deterministic import products based on normalized
structural fingerprints and collision ordinals. Selectors are binding hints,
not IDs. Compilation writes the canonical ID into a `data-motion-id` attribute,
so subsequent canonical work can address the element without a selector.

Reimport mapping after structural source changes is deferred. The current
contract guarantees that selector edits do not alter identity inside an
existing canonical document.

### Authoring viability

No motion-bearing CSS remains opaque. The target's animated property surface
includes layout coordinates, width, opacity, transform, foreground and
background color, border color, and box shadow. Values may contain CSS custom
property references or nested functions and therefore remain lossless CSS
strings in version 1, while timing and composition fields are typed.

This structure is sufficient for later typed operations to:

- create or delete animation rules and application slots;
- add, remove, or move keyframes;
- change values, easing, duration, delay, iteration, and step parameters;
- reuse one rule across multiple elements with independent delays;
- compose simultaneous animations on one element;
- insert holds or retime a range without editing raw animation CSS.

Those mutations and their UI are Phase 2 work. This phase proves that the
compiler consumes authorable structures rather than an imported snapshot.

## Import contract

Import is a two-stage operation:

```text
HTML/CSS source -> complete inventory -> validated canonical document
```

Inventory always completes where parsing permits. Canonicalization is atomic:
any error diagnostic prevents a document result. Warnings may accompany a
successful import only when they cannot change motion or rendering semantics.

The initial supported surface covers self-contained HTML, a style block,
ordinary selectors, custom properties, keyframe percentage selectors,
multi-property keyframes, animation shorthand, comma-separated animation
slots, delays, finite or infinite iterations, standard easing keywords,
`steps(n, position)`, and the animated property forms exercised by public
fixtures and the private first slice.

Fail-closed errors include:

- scripts or external resources;
- unresolved or duplicate keyframe-rule identity;
- animation shorthand that cannot be parsed without ambiguity;
- unsupported motion-bearing at-rules or pseudo-element applications;
- duplicate keyframe offsets with conflicting declarations;
- unsupported animation composition, timeline, range, or event-driven trigger;
- a referenced element or rule that cannot be bound exactly;
- any motion declaration omitted from the inventory or canonical document.

Diagnostics contain stable codes, severity, line and column, and a sanitized
technical summary. They never include selector text, source excerpts, private
copy, local paths, or branding.

## Compiler contract

The compiler validates the complete canonical document before emitting output.
It generates deterministic rule names, selector bindings, declaration order,
keyframe order, numeric formatting, whitespace, and final newlines. Equal
canonical bytes and compiler version must produce byte-identical HTML, CSS,
export digest, and compiler receipt.

The compiler reconstructs motion CSS only from rule, application, slot, track,
and keyframe records. It does not reuse imported motion declarations. Shared
rules remain shared, application delays remain application-specific, and slot
order is preserved.

The export is pure HTML/CSS. It has no production JavaScript runtime. The
compiler receipt contains schema and compiler versions; source, document, and
output digests; inventory counts; warning and error counts; and deterministic
status. It contains no source text or path.

## Preview and read-only timeline

The editor loads the compiler's exact output into a sandboxed iframe. The
preview runtime obtains animations from the iframe document with
`document.getAnimations()`, pauses them, and sets browser-owned `currentTime`
for scrubbing. Play and pause call the Web Animations API on those same browser
animation objects. There is no JavaScript interpolation engine.

The timeline groups rows by stable element ID and animated property. It shows
all tracks, keyframes, application delays, simultaneous slots, step timing, and
one global playhead. Its only controls are play, pause, and scrub. It performs
no canonical mutation.

The iframe sandbox allows only the minimum capability required for the static
compiled document and preview controller. Imported scripts are rejected rather
than executed.

## Visual-proof contract

The proof harness compares two separately loaded documents in the same pinned
Chromium revision and viewport:

1. the private imported baseline;
2. the deterministic compiler output from its canonical document.

For each document, the harness waits for DOM readiness, `document.fonts.ready`,
and equal layout measurements across consecutive animation frames. It then
pauses browser-created animations and sets their current times directly.

Samples include declared stable times plus one millisecond before and after
every derived discrete or step boundary. The harness records raw screenshots
only under gitignored artifact storage. It compares equal-sized RGBA buffers
with an exact controlled-environment threshold:

- changed pixels: `0`;
- changed-pixel ratio: `0`;
- maximum channel delta: `0`.

The original baseline is replayed three times. Corresponding frames must have
identical hashes across all three runs. Inventory counts and frame dimensions
must also match exactly.

The sanitized proof receipt contains source, canonical, and export digests;
tool and Chromium identities; viewport; readiness result; rule, application,
slot, track, supported, unsupported, and missing counts; sample count; repeated
hash stability; aggregate changed pixels and maximum channel delta; diagnostic
codes; and pass/fail status. It contains no screenshots, source, copy, selector
text, local paths, or branding.

## Private-corpus safety

The local manifest lives under gitignored `.private-corpus/` and may contain the
local path, source digest, viewport, font requirements, technical inventory,
and expected sampling points. Generated canonical documents and screenshots
from the private source live under gitignored `.motion/` and `artifacts/`.

Tracked evidence contains only sanitized receipts. Before handoff, inspect all
tracked files and the complete branch diff for private absolute paths, source
fragments, copy, branding, screenshots, databases, credentials, presigned URLs,
and private repository identifiers. Synthetic fixtures use neutral shapes,
labels, and colors unrelated to the private corpus.

## Testing strategy

Development follows red-green-refactor cycles. Focused tests cover:

- schema validation and canonical byte stability;
- stable identity independent of selector hints;
- exact rule, application, slot, delay, simultaneous-animation, step-timing,
  and property-track inventories;
- fail-closed diagnostics for each unsupported construct;
- deterministic compiler output across repeated runs;
- browser preview play, pause, and scrub using native animation current time;
- readiness, boundary sampling, repeated baseline hashing, and pixel-diff
  aggregation;
- end-to-end private acceptance with only sanitized outputs;
- repository scans and tracked-file checks for sensitive-content exclusion.

The private acceptance test is local and is never required to expose or commit
the corpus. Public CI-equivalent tests run entirely against synthetic fixtures.

## Exit gate and architecture-review stop

The slice is complete only when direct evidence proves:

- the private scene imports with nine rules, eight applications, the complete
  ordered slot inventory, all staggered delays, the simultaneous two-slot
  application, both step-timed slots, and every element/property track;
- three controlled baseline replays produce equal corresponding frame hashes;
- repeated canonical compilation produces byte-identical export and receipt
  digests;
- baseline and compiled samples are pixel-identical at stable times and on both
  sides of every discrete boundary;
- preview scrubbing controls browser-created animations;
- no sensitive private material exists in tracked content or the branch diff;
- focused tests, type checking, build, and repository checks pass.

At that point, report the user-facing claim, the top three realistic failure
modes, and the exact evidence for each claim. Stop for architecture review. Do
not begin Phase 2.
