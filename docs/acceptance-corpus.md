# Acceptance-Corpus Policy

## Private source material

The initial product need is grounded in real self-contained coach-mark scenes
and a larger synchronized landing animation. Those files remain private and
outside this public repository.

Do not commit:

- original HTML/CSS/React source;
- product copy, branding, screenshots, media, or design assets;
- absolute local paths or usernames;
- private repository URLs or access tokens;
- generated screenshots that reproduce private UI;
- local SQLite databases or captured browser storage.

## Permitted local manifest

A gitignored local manifest may record:

- a logical fixture name;
- local path;
- SHA-256 digest;
- viewport and font readiness requirements;
- counts of animation rules/applications;
- technical feature inventory;
- expected cue times and proof sampling points.

The manifest belongs under `.private-corpus/` and must never be staged.

## Public synthetic fixtures

Create minimal synthetic scenes that reproduce technical constructs without
private design or copy:

- continuous transform and opacity;
- repeated elements sharing a keyframe rule;
- staggered delays;
- multiple animation slots on one element;
- `steps(...)` timing and discrete visibility;
- typing-width simulation;
- cursor travel and click pulse;
- named cues and inserted holds;
- pseudo-elements;
- desktop/mobile variant overrides;
- reduced-motion snapshots;
- pause, restart, and in-view triggers.

Each fixture should isolate one or two risks. The private corpus proves product
fitness locally; synthetic fixtures make the implementation publicly testable.

## Evidence receipt

For every private-corpus run, record a sanitized receipt containing:

- source digest, never source content or path;
- importer/compiler versions;
- supported, unsupported, and missing feature counts;
- canonical document and export digests;
- viewport/browser/font readiness identity;
- frame hashes or aggregate diff metrics, not private screenshots;
- pass/fail status and sanitized diagnostics.

Receipts must be inspected before commit to ensure they cannot reconstruct or
identify private product content.
