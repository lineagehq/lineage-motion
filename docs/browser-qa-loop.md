# Browser QA Loop

Use this loop to repeatedly QA and polish the motion editor without turning a
focused CSS-animation tool into a general animation platform.

## Product purpose

Help a person create, inspect, and refine browser-native CSS animation through a
small set of understandable controls. Canonical typed operations remain the
source of truth; the preview renders deterministic compiler output and controls
browser-created animations.

## Before touching the UI

1. Run the editor from the worktree being reviewed on its own named `.localhost`
   subdomain and port (for example, `lineage-motion.localhost`). Never hand off
   an owner QA surface on raw `localhost`, `127.0.0.1`, or another loopback URL.
2. Confirm the page exposes the controls expected from that worktree. A running
   server from another branch is not valid QA evidence.
3. Reload to a fresh revision-zero state. Keep private scenes and evidence out
   of the browser walkthrough unless private acceptance is explicitly required.

## Canonical walkthrough

Perform this task in the visible browser, narrating the intent and the expected
result at each meaningful state:

1. Create the one supported animation track and confirm that the track, stable
   selection, revision, and preview linkage become visible.
2. Add a midpoint keyframe. Change duration, delay, and easing through the
   labeled controls. Confirm the timeline reprojects without changing stable
   identity or normalized offsets.
3. Scrub immediately before, at, and after each affected key moment. Exercise
   play and pause. Confirm the preview is compiler output controlled through
   browser-created `CSSAnimation` objects.
4. Remove the midpoint, then undo and redo. Confirm selection/focus remains
   understandable and corresponding states return exactly.
5. Complete the same path with keyboard activation. Submit one invalid value
   and inspect reduced motion. Confirm visible and announced feedback, retained
   focus, and no revision, history, compiler, iframe, or animation change after
   rejection.

## What to notice

Judge the experience as a motion author, not as the implementer:

- Can the next action be found without knowing canonical IDs or internal terms?
- Does every action immediately explain what changed and what is selected?
- Are timing values and key moments easy to connect to the preview?
- Do defaults produce a useful visible animation without extra setup?
- Are removal, undo, redo, validation, and keyboard focus predictable?
- Does any control appear usable before its prerequisite exists?
- Is internal evidence visible only when it helps, rather than dominating the
  authoring task?

Record concrete observations, including the action, expected result, observed
result, and why the difference matters. Do not invent improvements from taste
alone when the walkthrough produced no friction.

## Fix policy

Fix a finding in the same loop only when it is reproducible, clearly in the
current phase, and has a small solution. Prioritize:

1. blocked or misleading actions;
2. unclear selection, timing, or state feedback;
3. keyboard, focus, and validation defects;
4. control order, labels, defaults, and visual hierarchy;
5. minor visual polish that makes the canonical task easier to read.

Make one coherent correction at a time. Reuse the existing domain operation,
compiler, preview, and history boundaries. Do not add modes, generalized track
types, drag-and-drop systems, free-form CSS, persistence, collaboration, or new
architecture to solve a walkthrough problem.

## Recheck and stop

After each correction:

1. repeat the exact browser action that exposed the issue;
2. repeat the complete canonical walkthrough from a fresh state;
3. run the focused tests for the changed boundary, then the existing Chrome,
   visual, determinism, privacy, type, build, and diff gates required by the
   active phase;
4. inspect the complete diff for scope growth and sensitive content.

Stop the polish loop when the canonical walkthrough succeeds on the first try,
the next action and current state are clear, keyboard and rejection behavior are
predictable, and no blocker or material friction remains. Do not keep polishing
for novelty. Report:

- the user-facing claim;
- findings observed in the browser;
- corrections made and deliberately deferred;
- the top three realistic remaining failure modes;
- exact browser and automated evidence.
