# Canvas-First UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing durable motion editor canvas-first so the common object-and-moment workflow is immediately usable while exact and technical controls remain available in a non-remapping overlay drawer.

**Architecture:** Keep the canonical document, typed operation preparation, sole-writer service, compiler, iframe, native animation controller, and CLI unchanged. Recompose the existing Shot controls inside the preview panel using a floating object bar, a combined preview/moments rail, a selected-moment dock, and an ephemeral Advanced overlay; extend browser tests and the installed-Chrome harness around layout, focus, geometry, and existing operation bytes.

**Tech Stack:** TypeScript, DOM APIs, CSS, Playwright, Vitest, Vite, SQLite-backed local service, browser-native CSS animations.

**Spec:** `docs/superpowers/specs/2026-09-02-canvas-first-ux-polish-design.md`

## Global Constraints

- Do not add or change canonical animation entities, operation kinds, CLI commands, persistence, branches, claims, service writers, or compiler semantics.
- The iframe must continue to render compiler output, and scrubbing must continue to control browser-created CSS animations.
- Stable element identity remains independent from CSS selectors.
- Opening or closing Advanced must preserve canvas geometry within one CSS pixel.
- Start and Settle remain protected; intermediate points remain addable, removable, selectable, retimable, and deterministically renumbered.
- Human and CLI mutations continue through the same typed expected-revision operation path.
- No private fixtures, copy, branding, screenshots, corpus paths, credentials, databases, or generated private artifacts may be committed.
- Run the editor on a `lineage-motion.localhost` subdomain for browser QA.

## File Responsibility Map

- `apps/editor/src/main.ts`: Shot workspace markup, ephemeral dock/drawer state, focus restoration, and reuse of existing operation handlers.
- `apps/editor/src/styles.css`: Canvas-first layout, overlay geometry, visual hierarchy, responsive bottom-sheet adaptation, and focus treatments.
- `apps/editor/tests/moments.spec.ts`: Point inventory, moment naming, focus, dock state, and one-object/grouped moment behavior.
- `apps/editor/tests/phase3.spec.ts`: Durable mutation bytes, publication failure behavior, selection/native-preview synchronization, and geometry invariance.
- `apps/editor/scripts/qa-chrome.mjs`: Installed-Chrome canvas-first walkthrough and aggregate-only layout/native-animation receipt.

---

### Task 1: Recompose the Shot Workspace Around the Preview

**Files:**
- Modify: `apps/editor/src/main.ts:130-220`
- Modify: `apps/editor/src/main.ts:1940-2130`
- Modify: `apps/editor/src/styles.css:385-500`
- Test: `apps/editor/tests/phase3.spec.ts:146-260`

**Interfaces:**
- Consumes: existing global selectors, `activateShotLayout()`, `configurePreviewCanvas()`, `renderShotWorkspace()`, and the current Preview transport.
- Produces: `[data-shot-object-bar]`, `[data-preview-control-rail]`, `[data-shot-context-dock]`, and `[data-shot-advanced-drawer]` inside `.preview-panel`; existing `data-*` hooks for operations remain unchanged.

- [ ] **Step 1: Write a failing layout contract**

Add these assertions immediately after the Shot workspace becomes visible in the five-operation Phase 3 browser test:

```ts
const layoutContract = await page.evaluate(() => {
  const preview = document.querySelector<HTMLElement>('.preview-panel')!;
  const stage = document.querySelector<HTMLElement>('.preview-stage')!;
  const objectBar = document.querySelector<HTMLElement>('[data-shot-object-bar]')!;
  const dock = document.querySelector<HTMLElement>('[data-shot-context-dock]')!;
  const rail = document.querySelector<HTMLElement>('[data-preview-control-rail]')!;
  return {
    objectBarInsidePreview: preview.contains(objectBar),
    dockInsidePreview: preview.contains(dock),
    railInsidePreview: preview.contains(rail),
    stageHeight: Math.round(stage.getBoundingClientRect().height),
    order: [objectBar, stage, dock, rail].map((node) =>
      Math.round(node.getBoundingClientRect().top)),
  };
});
expect(layoutContract.objectBarInsidePreview).toBe(true);
expect(layoutContract.dockInsidePreview).toBe(true);
expect(layoutContract.railInsidePreview).toBe(true);
expect(layoutContract.stageHeight).toBeGreaterThanOrEqual(430);
expect(layoutContract.order[0]).toBeLessThan(layoutContract.order[3]);
```

- [ ] **Step 2: Run the focused test and confirm the missing hooks fail**

Run:

```bash
npm exec playwright test -- apps/editor/tests/phase3.spec.ts --grep "Shot 1 workspace commits"
```

Expected: FAIL because the approved object bar, context dock, and combined rail do not yet exist inside `.preview-panel`.

- [ ] **Step 3: Move presentation markup without changing operation hooks**

Move the Shot workspace into `.preview-panel` before `.preview-stage`. Replace its visible control-panel structure with this hierarchy while retaining each existing form control and `data-*` operation hook:

```html
<section class="shot-workspace" data-shot-workspace hidden aria-labelledby="shot-workspace-heading">
  <h2 class="visually-hidden" id="shot-workspace-heading">Shape motion directly on the canvas</h2>
  <div class="shot-object-bar" data-shot-object-bar>
    <fieldset data-shot-targets><legend>Object</legend></fieldset>
    <button type="button" data-shot-mode="path" aria-label="Path" aria-pressed="true">Hide path</button>
    <label class="move-together"><input type="checkbox" data-move-together aria-label="Edit together"><span>Edit together</span></label>
  </div>
  <p class="visually-hidden" data-shot-guidance role="note"></p>
  <section class="shot-context-dock" data-shot-context-dock aria-label="Selected moment controls"></section>
  <aside class="shot-advanced-drawer" data-shot-advanced-drawer hidden aria-label="Advanced motion controls"></aside>
  <div data-shot-history-slot></div>
  <output data-shot-status role="status" aria-live="polite"></output>
  <section data-shot-recovery hidden aria-labelledby="shot-recovery-heading"></section>
</section>
```

Wrap transport and the existing moments fieldset in one permanent rail after `.preview-stage`:

```html
<div class="preview-control-rail" data-preview-control-rail>
  <div class="transport" aria-label="Preview transport">
    <button type="button" data-play>Play</button>
    <button type="button" data-pause>Pause</button>
    <label>Preview time <input data-scrub type="range" min="0" step="1" value="0"></label>
    <output data-playhead>0 ms</output>
  </div>
  <fieldset class="shot-moments" data-shot-moments hidden>
    <legend>Animation moments</legend>
    <div data-shot-moment-sequence></div>
  </fieldset>
</div>
```

Remove `layout.insertBefore(shotWorkspace, workflow)` from `activateShotLayout()` because the workspace now starts in its final parent. Toggle `shotMoments.hidden` together with `shotWorkspace.hidden` in Shot availability and recovery paths.

Because the moments fieldset is no longer a descendant of `shotWorkspace`, replace
the existing descendant-only enable/disable loops with one shared helper:

```ts
function forEachShotControl(callback: (control: HTMLInputElement | HTMLButtonElement | HTMLSelectElement) => void): void {
  for (const root of [shotWorkspace, shotMoments]) {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(callback);
  }
}
```

Use this helper in both editable and unavailable/recovery paths so a visually
hidden rail can never retain an enabled persistent control.

- [ ] **Step 4: Apply the canvas-first CSS grid**

Use `.preview-panel` as the stable containing block and keep the stage size independent of overlay controls:

```css
.shot-active .preview-panel { position: relative; display: grid; grid-template-rows: auto minmax(430px, 1fr) auto; }
.shot-active .shot-workspace { display: contents; }
.shot-active .shot-object-bar { position: absolute; z-index: 12; top: 52px; left: 50%; display: flex; gap: 6px; translate: -50% 0; }
.shot-active .preview-stage { grid-row: 2; min-height: 430px; }
.shot-active .preview-control-rail { grid-row: 3; position: relative; z-index: 11; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 8px 12px; }
.shot-active .transport { display: flex; align-items: center; gap: 7px; padding: 0; border: 0; }
.shot-active .shot-moments:not([hidden]) { display: flex; min-width: 0; margin: 0; padding: 0; border: 0; }
```

Retain the existing stage runway and preview-canvas scaling calculations. Do not compensate for the floating bar in compiler coordinates.

- [ ] **Step 5: Run the layout contract and existing moments test**

Run:

```bash
npm exec playwright test -- apps/editor/tests/phase3.spec.ts --grep "Shot 1 workspace commits" apps/editor/tests/moments.spec.ts
npm run typecheck
```

Expected: PASS; the stage remains at least 430 CSS pixels high and all existing operation hooks resolve.

- [ ] **Step 6: Commit the independently reviewable layout slice**

```bash
git add apps/editor/src/main.ts apps/editor/src/styles.css apps/editor/tests/phase3.spec.ts
git commit -m "Refocus motion editing around the canvas"
```

---

### Task 2: Make Moment Selection Drive One Context Dock

**Files:**
- Modify: `apps/editor/src/main.ts:2200-2350`
- Modify: `apps/editor/src/main.ts:2850-2960`
- Modify: `apps/editor/src/styles.css:400-480`
- Test: `apps/editor/tests/moments.spec.ts:35-120`

**Interfaces:**
- Consumes: `shotMomentLabel(timeMs)`, `selectShotMoment(timeMs)`, `addShotMoment(beforeMs, afterMs)`, `removeShotMoment()`, `applyShotMomentTime(targetTimeMs)`, and `applyShotEasing()`.
- Produces: `renderShotContextDock()`, `[data-shot-context-name]`, `[data-shot-context-time]`, `[data-shot-context-easing]`, `[data-shot-context-remove]`, and `[data-shot-advanced-toggle]`.

- [ ] **Step 1: Write failing dock, selection, and focus assertions**

Extend the repeatable-moments browser test:

```ts
const dock = page.locator('[data-shot-context-dock]');
await expect(dock.locator('[data-shot-context-name]')).toHaveText('Point 1');
await expect(dock.locator('[data-shot-context-time]')).toHaveValue('700');
await expect(dock.locator('[data-shot-context-easing]')).toHaveValue('ease-out');

await workspace.locator('.moment-add').first().click();
const pointOne = page.getByRole('radio', { name: 'Point 1 350 ms' });
await expect(pointOne).toBeChecked();
await expect(pointOne).toBeFocused();
await expect(dock.locator('[data-shot-context-name]')).toHaveText('Point 1');
await expect(dock.locator('[data-shot-context-time]')).toHaveValue('350');

await dock.locator('[data-shot-context-remove]').click();
await expect(page.getByRole('radio', { name: 'Start 0 ms' })).toBeChecked();
await expect(page.getByRole('radio', { name: 'Start 0 ms' })).toBeFocused();
```

- [ ] **Step 2: Run the focused test and verify the dock hooks fail**

Run:

```bash
npm exec playwright test -- apps/editor/tests/moments.spec.ts
```

Expected: FAIL because context controls still live in the old always-visible moment panel and mutation completion does not restore focus to the selected moment.

- [ ] **Step 3: Render the selected moment into the dock**

Add one rendering function and call it from `renderShotWorkspace()` after moment inventory is known:

```ts
function renderShotContextDock(): void {
  if (!shotConfig) return;
  required<HTMLElement>('[data-shot-context-name]').textContent = shotMomentLabel(shotMomentMs);
  const time = required<HTMLInputElement>('[data-shot-context-time]');
  time.value = String(shotMomentMs);
  time.disabled = shotMomentMs === shotConfig.startMs || shotMomentMs === shotConfig.settledMs;
  const remove = required<HTMLButtonElement>('[data-shot-context-remove]');
  remove.hidden = time.disabled;
  remove.disabled = time.disabled;
}
```

Place the existing timing range, easing selector, apply button, and remove action in the dock. Add presentation hooks alongside the operation hooks on the same elements—for example, `data-shot-context-time data-shot-moment-time`, `data-shot-context-easing data-shot-easing`, and `data-shot-context-remove data-shot-remove-moment`. Continue calling the same typed operation functions.

- [ ] **Step 4: Restore focus after inventory-changing operations**

Add a narrowly scoped helper:

```ts
function focusShotMoment(timeMs: number): void {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(
    `input[name="shot-moment"][value="${timeMs}"]`)?.focus());
}
```

Call `focusShotMoment(timeMs)` only after a successful add and call
`focusShotMoment(previous)` only after a successful removal. Failed operations
must leave focus and the selected moment unchanged.

- [ ] **Step 5: Keep Start, intermediate points, and Settle semantically distinct**

In `renderShotContextDock()`, disable time, easing, apply, and remove when the
selected moment has no following editable segment. Preserve the existing
plain-language status output and keep diagnostic codes out of the primary dock.

- [ ] **Step 6: Run focused interaction and durable-byte tests**

Run:

```bash
npm exec playwright test -- apps/editor/tests/moments.spec.ts apps/editor/tests/phase3.spec.ts --grep "moments|Shot 1 workspace commits|asymmetric"
npm run test:phase3:parity
npm run typecheck
```

Expected: PASS; add, retime, easing, remove, Undo, and Redo still emit the same typed command kinds and the newly selected moment receives focus.

- [ ] **Step 7: Commit the contextual-moment slice**

```bash
git add apps/editor/src/main.ts apps/editor/src/styles.css apps/editor/tests/moments.spec.ts apps/editor/tests/phase3.spec.ts
git commit -m "Add contextual moment controls"
```

---

### Task 3: Add a Non-Remapping Advanced Overlay

**Files:**
- Modify: `apps/editor/src/main.ts:95-175`
- Modify: `apps/editor/src/main.ts:250-360`
- Modify: `apps/editor/src/styles.css:60-95`
- Modify: `apps/editor/src/styles.css:430-510`
- Test: `apps/editor/tests/phase3.spec.ts:180-300`

**Interfaces:**
- Consumes: the existing pose form, settled-hold controls, `.collaboration-bar`, `.inspect-panel`, and all their global `data-*` hooks.
- Produces: `setShotAdvancedOpen(open: boolean, returnFocus?: boolean)`, `[data-shot-advanced-close]`, collapsed drawer groups, Escape dismissal, and invariant stage/canvas geometry.

- [ ] **Step 1: Write a failing geometry and focus test**

Add this test after initial Shot layout assertions:

```ts
const readGeometry = () => page.evaluate(() => {
  const selectors = ['.preview-stage', '[data-preview-canvas]', '[data-preview-object-overlay]', '[data-trajectory-overlay]'];
  return Object.fromEntries(selectors.map((selector) => {
    const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    return [selector, [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10)];
  }));
});
const closedGeometry = await readGeometry();
const advanced = page.getByRole('button', { name: 'Advanced motion controls' });
await advanced.click();
await expect(page.locator('[data-shot-advanced-drawer]')).toBeVisible();
expect(await readGeometry()).toEqual(closedGeometry);
await page.keyboard.press('Escape');
await expect(page.locator('[data-shot-advanced-drawer]')).toBeHidden();
await expect(advanced).toBeFocused();
expect(await readGeometry()).toEqual(closedGeometry);
```

- [ ] **Step 2: Run the focused test and verify the drawer contract fails**

Run:

```bash
npm exec playwright test -- apps/editor/tests/phase3.spec.ts --grep "Shot 1 workspace commits"
```

Expected: FAIL because Advanced is still a `details` panel without explicit overlay, dismissal, or geometry guarantees.

- [ ] **Step 3: Implement one ephemeral drawer controller**

Use `hidden` and ARIA state only; do not store drawer visibility in the motion document:

```ts
const shotAdvancedToggle = required<HTMLButtonElement>('[data-shot-advanced-toggle]');
const shotAdvancedDrawer = required<HTMLElement>('[data-shot-advanced-drawer]');

function setShotAdvancedOpen(open: boolean, returnFocus = false): void {
  shotAdvancedDrawer.hidden = !open;
  shotAdvancedToggle.setAttribute('aria-expanded', String(open));
  document.querySelector('.editor-shell')?.classList.toggle('shot-advanced-open', open);
  if (open) required<HTMLButtonElement>('[data-shot-advanced-close]').focus();
  else if (returnFocus) shotAdvancedToggle.focus();
}

shotAdvancedToggle.addEventListener('click', () => setShotAdvancedOpen(shotAdvancedDrawer.hidden));
required<HTMLButtonElement>('[data-shot-advanced-close]').addEventListener('click', () => setShotAdvancedOpen(false, true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !shotAdvancedDrawer.hidden) setShotAdvancedOpen(false, true);
});
```

- [ ] **Step 4: Group existing technical surfaces inside the drawer**

Render the existing pose and hold controls in closed `<details>` groups. During
Shot activation, append the existing `.collaboration-bar` and `.inspect-panel`
nodes to `[data-shot-advanced-technical]`; global selectors and handlers continue
to reference the same nodes, so no duplicate controls or state are created.

```ts
function mountShotAdvancedSurfaces(): void {
  const technical = required<HTMLElement>('[data-shot-advanced-technical]');
  const collaboration = document.querySelector<HTMLElement>('.collaboration-bar');
  const inspector = required<HTMLDetailsElement>('.inspect-panel');
  if (collaboration) technical.append(collaboration);
  technical.append(inspector);
}
```

- [ ] **Step 5: Overlay rather than reflow the canvas**

```css
.shot-active .shot-advanced-drawer { position: absolute; z-index: 20; top: 44px; right: 10px; bottom: 58px; width: min(360px, calc(100% - 20px)); overflow: auto; border: 1px solid #53677c; border-radius: 14px; background: #111722; box-shadow: 0 24px 80px rgba(0,0,0,.62); }
.shot-active .shot-advanced-drawer[hidden] { display: none; }
.shot-active .shot-advanced-drawer details:not([open]) > :not(summary) { display: none; }
.shot-active .preview-stage,
.shot-active .preview-canvas { inline-size: 100%; }
```

Do not add padding, margin, grid columns, or transforms to the stage when
`.shot-advanced-open` is present.

- [ ] **Step 6: Prove failure behavior remains coherent while the drawer is open**

Extend the existing delayed/failed publication test to open Advanced before the
injected failure, then assert the prior revision, iframe source, selected moment,
and stage geometry survive the failure and retry. Expect the primary status to
contain the plain-language failure while `[data-service-diagnostic]` retains the
sanitized diagnostic.

- [ ] **Step 7: Run drawer, publication, collaboration, and browser tests**

Run:

```bash
npm exec playwright test -- apps/editor/tests/phase3.spec.ts --grep "publication|Shot 1 workspace commits|branch|claim"
npm exec playwright test -- apps/editor/tests/integrated-dogfood.spec.ts
npm run test:phase3:service
npm run test:phase3:recovery
npm run typecheck
```

Expected: PASS; drawer state remains ephemeral and no service or operation bytes change.

- [ ] **Step 8: Commit the Advanced overlay slice**

```bash
git add apps/editor/src/main.ts apps/editor/src/styles.css apps/editor/tests/phase3.spec.ts
git commit -m "Move technical controls into an overlay drawer"
```

---

### Task 4: Responsive, Installed-Chrome, and Adversarial Proof

**Files:**
- Modify: `apps/editor/src/styles.css:480-520`
- Modify: `apps/editor/scripts/qa-chrome.mjs`
- Test: `apps/editor/tests/moments.spec.ts`
- Test: `apps/editor/tests/phase3.spec.ts`

**Interfaces:**
- Consumes: all approved canvas-first hooks from Tasks 1–3 and the existing installed-Chrome launcher.
- Produces: `--canvas-first-ux` Chrome QA mode and an aggregate-only receipt containing layout, focus, operation-count, native-animation, geometry-delta, console-error, and privacy-safe boolean/count fields.

- [ ] **Step 1: Add failing responsive and hit-area assertions**

At desktop and 680-pixel viewports, assert that the rail remains reachable, the
object bar does not cover the selected transform box, destination labels do not
overlap, and effective handle hit areas remain at least 44 pixels:

```ts
const interactionGeometry = await page.evaluate(() => ({
  handles: [...document.querySelectorAll<HTMLElement>('.trajectory-waypoint, .preview-transform-handle')]
    .map((node) => {
      const size = node.matches('.trajectory-waypoint')
        ? getComputedStyle(node, '::before')
        : node.getBoundingClientRect();
      return { width: parseFloat(String(size.width)), height: parseFloat(String(size.height)) };
    }),
  railVisible: document.querySelector<HTMLElement>('[data-preview-control-rail]')!.getBoundingClientRect().bottom <= innerHeight,
}));
expect(interactionGeometry.railVisible).toBe(true);
expect(interactionGeometry.handles.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
```

- [ ] **Step 2: Run the responsive test and confirm current CSS fails**

Run:

```bash
npm exec playwright test -- apps/editor/tests/moments.spec.ts --project chromium
```

Expected: FAIL at the narrow viewport until rail scrolling and drawer adaptation are implemented.

- [ ] **Step 3: Add the narrow-width bottom-sheet adaptation**

```css
@media (max-width: 700px) {
  .shot-active .shot-object-bar { top: 48px; max-width: calc(100% - 20px); overflow-x: auto; }
  .shot-active .preview-control-rail { grid-template-columns: 1fr; }
  .shot-active [data-shot-moment-sequence] { overflow-x: auto; scroll-snap-type: x proximity; }
  .shot-active .shot-advanced-drawer { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 68%; border-radius: 14px 14px 8px 8px; }
}
```

Keep the stage coordinate system unchanged; scrolling occurs in controls only.

- [ ] **Step 4: Extend the installed-Chrome harness**

Add `--canvas-first-ux` to the existing argument parser. The mode must launch the
real editor from the current worktree on `lineage-motion.localhost`, execute the
common workflow through DOM controls, and print only this aggregate receipt shape:

```json
{
  "schemaVersion": "motion.canvas-first-qa.v1",
  "passed": true,
  "viewport": { "width": 1440, "height": 900, "dpr": 1 },
  "operationCount": 0,
  "momentCount": 0,
  "geometryMaxDeltaCssPx": 0,
  "nativeCssAnimationCount": 0,
  "keyboardFlowPassed": false,
  "failurePreservedCompiler": false,
  "consoleErrorCount": 0,
  "networkErrorCount": 0
}
```

The receipt must not contain source HTML/CSS, visible copy, element IDs, selectors,
absolute paths, screenshots, capabilities, URLs, or database locations.

- [ ] **Step 5: Run the complete named-subdomain workflow manually in Chrome**

Starting from revision zero:

1. Select Object 1 and Point 1.
2. Drag, scale, and rotate the object.
3. Add a point, retime it, and change its movement preset.
4. Switch to Object 2, then enable and disable `Edit together`.
5. Play, pause, and scrub across every moment.
6. Open and close Advanced while comparing stage and object geometry.
7. Remove the new point, Undo, and Redo.
8. Repeat selection, insertion, and removal with keyboard input.
9. Trigger one invalid or stale operation and verify the prior compiled view remains coherent.

Record only aggregate observations in the harness receipt.

- [ ] **Step 6: Run focused and full regression gates**

Run:

```bash
npm exec playwright test -- apps/editor/tests/moments.spec.ts apps/editor/tests/phase3.spec.ts apps/editor/tests/integrated-dogfood.spec.ts
node apps/editor/scripts/qa-chrome.mjs --canvas-first-ux
npm run test:unit
npm run test:phase3:service
npm run test:phase3:recovery
npm run test:phase3:parity
npm run verify:determinism
npm run test:visual:trajectory
npm run typecheck
npm run build
npm run check:sensitive
npm run check:private-ignore
git diff --check
```

Expected: every command passes; the Chrome receipt reports `passed: true`,
`geometryMaxDeltaCssPx <= 1`, at least one browser-created CSS animation, zero
console/network errors, and no sensitive fields.

- [ ] **Step 7: Inspect the complete diff against the three failure modes**

Verify directly that:

1. every primary action is present without opening Advanced and grouping scope is visible before mutation;
2. no Advanced/open responsive selector changes stage, canvas, object-overlay, or trajectory-overlay geometry;
3. no new state is serialized into the canonical document or bypasses typed service preparation.

Run:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- apps/editor/src/main.ts apps/editor/src/styles.css apps/editor/tests apps/editor/scripts/qa-chrome.mjs
```

- [ ] **Step 8: Commit the proof-complete polish slice**

```bash
git add apps/editor/src/styles.css apps/editor/scripts/qa-chrome.mjs apps/editor/tests/moments.spec.ts apps/editor/tests/phase3.spec.ts
git commit -m "Prove canvas-first motion editing UX"
```

## Handoff Gate

Do not open or merge a pull request as part of plan execution unless the owner
separately authorizes it. Before handoff, report the user-facing claim, the top
three realistic failure modes, the exact browser and automated evidence, the
complete public diff inventory, and the sensitive-content exclusion result.
