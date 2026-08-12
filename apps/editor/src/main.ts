import payload from 'virtual:motion-document';
import { compileMotionDocument } from '../../../packages/css-compiler/src/index.js';
import {
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  projectTrackCreationEligibility,
  sha256Hex,
  type AuthoringOperation,
  type StructuralAuthoringElementId,
} from '../../../packages/domain/src/index.js';
import {
  buildTimeline,
  NativePreviewController,
  type TimelineRow,
} from '../../../packages/preview-runtime/src/index.js';
import './styles.css';

let authoring = createAuthoringState(payload.document);
let compiled = payload.compiled;
let operationSequence = 0;
const creationChoices = [
  { elementId: 'el_a2849ff826f3e167', label: 'Cursor' },
  { elementId: 'el_2dbee68b1ea318c8', label: 'Orb' },
] as const;
const statusCopyElementId = 'el_1f3f2908e4fd2401';
let selectedCreationElementId: StructuralAuthoringElementId | null = null;
let selectedTrackId = findEditableTrack().trackId;
let selectedKeyframeId = findEditableTrack().keyframes[0]!.id;

document.body.innerHTML = `
  <main class="editor-shell">
    <header class="topbar">
      <div><p class="eyebrow">Typed canonical authoring</p><h1>Motion Editor</h1></div>
      <div class="transport" aria-label="Preview transport">
        <button type="button" data-play>Play</button><button type="button" data-pause>Pause</button>
        <label>Master time <input data-scrub type="range" min="0" max="${authoring.document.durationMs}" step="1" value="0"></label>
        <output data-playhead>0 ms</output>
      </div>
    </header>
    <section class="authoring-panel" aria-label="Selected keyframe authoring">
      <div class="selection" data-selection></div>
      <form data-value-form><label>Opacity value <input data-value type="number" min="0" max="1" step="0.000001" required></label><button type="submit">Set value</button></form>
      <form data-time-form><label>Master time (ms) <input data-time type="number" min="0" step="1" required></label><button type="submit">Set time</button></form>
      <div class="history"><button type="button" data-undo>Undo</button><button type="button" data-redo>Redo</button></div>
      <output class="operation-status" data-operation-status role="status" aria-live="polite">Revision 0 ready.</output>
    </section>
    <section class="structural-panel" aria-label="Bounded opacity track creation">
      <div class="structural-heading"><strong>Choose an opacity target</strong><span data-structural-status>Select an available target to begin.</span></div>
      <fieldset class="target-choices" data-target-choices><legend>Target and property</legend>
        ${creationChoices.map((choice) => `<label><input type="radio" name="creation-target" value="${choice.elementId}"><span><strong>${choice.label} — Opacity</strong><small data-choice-reason="${choice.elementId}">Available</small></span></label>`).join('')}
        <div class="unavailable-choice" data-status-copy><span><strong>Status copy — Opacity</strong><small data-choice-reason="${statusCopyElementId}">Already has an opacity track.</small></span></div>
      </fieldset>
      <div class="structural-step"><span>1 · Create</span><button type="button" data-create-track disabled>Select a target</button></div>
      <div class="structural-step"><span>2 · Shape</span><button type="button" data-add-midpoint>Add midpoint</button><button type="button" data-remove-midpoint>Remove midpoint</button></div>
      <div class="structural-step structural-timing"><span>3 · Time</span>
        <label>Duration (ms) <input data-duration type="number" min="1" step="1" value="1400"></label><button type="button" data-set-duration>Apply</button>
        <label>Delay (ms) <input data-delay type="number" min="0" step="1" value="700"></label><button type="button" data-set-delay>Apply</button>
        <label>Easing <select data-easing><option value="linear">linear</option><option value="ease-in-out">ease-in-out</option></select></label><button type="button" data-set-easing>Apply</button>
      </div>
    </section>
    <section class="workspace">
      <section class="preview-panel" aria-label="Compiled preview">
        <div class="panel-heading"><span>Compiler output</span><span class="preview-heading-status"><span data-preview-selection-label></span><span class="status">Sandboxed · native CSS</span></span></div>
        <div class="preview-stage"><iframe data-preview title="Compiled motion preview"></iframe><div class="preview-selection" data-preview-selection hidden><span>Selected element</span></div></div>
        <button class="reduced-toggle" type="button" data-reduced-toggle aria-expanded="false">Inspect reduced motion</button>
        <section data-reduced-motion-panel data-mode="${authoring.document.reducedMotion.mode}" data-css="${authoring.document.reducedMotion.css}" class="reduced-panel" hidden>
          <strong>source-snapshot</strong><p>Inspection only. The canonical document and compiler output remain unchanged.</p><pre></pre>
        </section>
      </section>
      <aside class="cue-panel" aria-label="Narrative cues"><div class="panel-heading"><span>Narrative cues</span><span data-cue-count></span></div><div data-cues class="cue-list"></div></aside>
    </section>
    <section class="timeline-panel" aria-label="Master timeline">
      <div class="panel-heading"><span>Stable element / property tracks</span><span data-track-count></span></div>
      <div data-timeline class="timeline"></div>
    </section>
  </main>`;

const iframe = required<HTMLIFrameElement>('[data-preview]');
const controller = new NativePreviewController(iframe);
const scrubber = required<HTMLInputElement>('[data-scrub]');
const playhead = required<HTMLOutputElement>('[data-playhead]');
const status = required<HTMLOutputElement>('[data-operation-status]');
const valueInput = required<HTMLInputElement>('[data-value]');
const timeInput = required<HTMLInputElement>('[data-time]');
const undoButton = required<HTMLButtonElement>('[data-undo]');
const redoButton = required<HTMLButtonElement>('[data-redo]');
const createTrackButton = required<HTMLButtonElement>('[data-create-track]');
const addMidpointButton = required<HTMLButtonElement>('[data-add-midpoint]');
const removeMidpointButton = required<HTMLButtonElement>('[data-remove-midpoint]');
const durationInput = required<HTMLInputElement>('[data-duration]');
const delayInput = required<HTMLInputElement>('[data-delay]');
const easingInput = required<HTMLSelectElement>('[data-easing]');
const setDurationButton = required<HTMLButtonElement>('[data-set-duration]');
const setDelayButton = required<HTMLButtonElement>('[data-set-delay]');
const setEasingButton = required<HTMLButtonElement>('[data-set-easing]');
const previewStage = required<HTMLElement>('.preview-stage');
const previewSelection = required<HTMLElement>('[data-preview-selection]');
const previewSelectionLabel = required<HTMLElement>('[data-preview-selection-label]');

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) {
  radio.addEventListener('change', () => {
    selectedCreationElementId = radio.value as StructuralAuthoringElementId;
    updateStructuralControls(buildTimeline(authoring.document).rows);
    schedulePreviewSelection();
  });
}

required<HTMLButtonElement>('[data-play]').addEventListener('click', () => {
  previewSelection.hidden = true;
  controller.play();
});
required<HTMLButtonElement>('[data-pause]').addEventListener('click', () => {
  controller.pause();
  schedulePreviewSelection();
});
scrubber.addEventListener('input', () => scrub(Number(scrubber.value)));
required<HTMLFormElement>('[data-value-form]').addEventListener('submit', (event) => {
  event.preventDefault(); void dispatch(makeEdit('motion.keyframe-value.set', { value: Number(valueInput.value) }));
});
required<HTMLFormElement>('[data-time-form]').addEventListener('submit', (event) => {
  event.preventDefault(); void dispatch(makeEdit('motion.keyframe-time.set', { timeMs: Number(timeInput.value) }));
});
valueInput.addEventListener('invalid', () => announceInvalidInput(valueInput, 'Opacity value'));
timeInput.addEventListener('invalid', () => announceInvalidInput(timeInput, 'Master time'));
valueInput.addEventListener('input', () => clearValidationFeedback(valueInput));
timeInput.addEventListener('input', () => clearValidationFeedback(timeInput));
undoButton.addEventListener('click', () => void dispatch(makeHistory('motion.history.undo')));
redoButton.addEventListener('click', () => void dispatch(makeHistory('motion.history.redo')));
createTrackButton.addEventListener('click', () => {
  if (!selectedCreationElementId) return;
  const elementId = selectedCreationElementId;
  void dispatch({
  ...operationEnvelope(), kind: 'motion.track.create', elementId,
  payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 },
  } as AuthoringOperation, `[data-element-id="${elementId}"][data-property="opacity"] .keyframe[data-offset="0"]`);
});
addMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.add', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { timeMs: 1110, value: 0.5 },
}), () => `[data-element-id="${selectedCreationElementId}"][data-property="opacity"] .keyframe[data-offset="0.5"]`));
setDurationButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.slot-duration.set', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { durationMs: Number(required<HTMLInputElement>('[data-duration]').value) },
})));
setDelayButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.binding-delay.set', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { delayMs: Number(required<HTMLInputElement>('[data-delay]').value) },
})));
setEasingButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.slot-easing.set', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { easing: required<HTMLSelectElement>('[data-easing]').value as 'linear' | 'ease-in-out' },
})));
removeMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.remove', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  keyframeId: track.keyframes.find((keyframe) => keyframe.offset === 0.5)?.id ?? '',
}), () => `[data-element-id="${selectedCreationElementId}"][data-property="opacity"] .keyframe[data-offset="1"]`));
for (const [selector, label] of [['[data-duration]', 'Duration'], ['[data-delay]', 'Delay']] as const) {
  const input = required<HTMLInputElement>(selector);
  input.addEventListener('invalid', () => announceInvalidInput(input, label));
  input.addEventListener('input', () => clearValidationFeedback(input));
}
const reducedToggle = required<HTMLButtonElement>('[data-reduced-toggle]');
const reducedPanel = required<HTMLElement>('[data-reduced-motion-panel]');
reducedPanel.querySelector('pre')!.textContent = authoring.document.reducedMotion.css;
reducedToggle.addEventListener('click', () => {
  const expanded = reducedToggle.getAttribute('aria-expanded') === 'true';
  reducedToggle.setAttribute('aria-expanded', String(!expanded));
  reducedPanel.hidden = expanded;
});

renderProjection();
await controller.mount(compiled.html);
schedulePreviewSelection();
document.querySelector('main')!.setAttribute('data-editor-ready', 'true');
window.addEventListener('resize', schedulePreviewSelection);

window.__motionEditor = {
  get compiledHtml() { return compiled.html; },
  get trackIds() { return buildTimeline(authoring.document).rows.map((row) => row.trackId); },
  get cueIds() { return authoring.document.cues.map((cue) => cue.id); },
  get canonicalProjection() { return buildTimeline(authoring.document); },
  readState: () => controller.readState(),
  inspectAuthoring: () => ({
    documentId: authoring.document.documentId,
    revision: authoring.document.revision,
    contentDigest: sha256Hex(canonicalContentBytes(authoring.document)),
    exportDigest: compiled.exportDigest,
    compiledHtml: compiled.html,
    undoCount: authoring.undo.length,
    redoCount: authoring.redo.length,
    consumedOperationIds: [...authoring.consumedOperationIds],
    selectedTrackId,
    selectedKeyframeId,
    selectedCreationElementId,
  }),
  dispatch,
};

async function dispatch(operation: AuthoringOperation, focusSelector?: string): Promise<{ ok: boolean; code?: string }> {
  const result = dispatchAuthoringOperation(authoring, operation);
  if (!result.ok) {
    if (operation.kind === 'motion.slot-duration.set') {
      required<HTMLInputElement>('[data-duration]').setAttribute('aria-invalid', 'true');
    } else if (operation.kind === 'motion.binding-delay.set') {
      required<HTMLInputElement>('[data-delay]').setAttribute('aria-invalid', 'true');
    }
    status.value = `${diagnosticMessage(result.diagnostic.code)} (${result.diagnostic.code}) Revision ${authoring.document.revision} unchanged.`;
    status.dataset.kind = 'error';
    return { ok: false, code: result.diagnostic.code };
  }
  authoring = result.state;
  compiled = compileMotionDocument(authoring.document);
  await controller.mount(compiled.html);
  const created = findCreatedTrack(buildTimeline(authoring.document).rows);
  if (created) {
    selectedTrackId = created.trackId;
    if (operation.kind === 'motion.keyframe.add') {
      selectedKeyframeId = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
    } else if (operation.kind === 'motion.keyframe.remove') {
      selectedKeyframeId = created.keyframes.at(-1)!.id;
    } else if (operation.kind === 'motion.track.create'
      || !created.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)) {
      selectedKeyframeId = created.keyframes[0]!.id;
    }
  } else {
    const fallback = findEditableTrack();
    selectedTrackId = fallback.trackId;
    if (!fallback.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)) {
      selectedKeyframeId = fallback.keyframes[0]!.id;
    }
  }
  renderProjection();
  status.value = `${successMessage(operation.kind)} Revision ${authoring.document.revision}.`;
  status.dataset.kind = 'success';
  if (focusSelector) required<HTMLElement>(focusSelector).focus();
  return { ok: true };
}

function operationEnvelope() {
  return { schemaVersion: 'motion.operation.v1' as const, operationId: nextOperationId(),
    documentId: authoring.document.documentId, expectedRevision: authoring.document.revision };
}

async function withCreatedTrack(
  create: (track: TimelineRow) => AuthoringOperation,
  focusSelector?: string | (() => string),
): Promise<{ ok: boolean; code?: string }> {
  const track = findCreatedTrack(buildTimeline(authoring.document).rows);
  if (!track) {
    status.value = `AUTHORING_TRACK_NOT_FOUND: operation rejected; revision ${authoring.document.revision} unchanged.`;
    status.dataset.kind = 'error'; return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  }
  return dispatch(create(track), typeof focusSelector === 'function' ? focusSelector() : focusSelector);
}

function makeEdit(
  kind: 'motion.keyframe-value.set' | 'motion.keyframe-time.set',
  payload: { value: number } | { timeMs: number },
): AuthoringOperation {
  const target = currentTarget();
  return {
    schemaVersion: 'motion.operation.v1', operationId: nextOperationId(),
    documentId: authoring.document.documentId, expectedRevision: authoring.document.revision,
    kind, elementId: target.elementId, trackId: target.trackId, keyframeId: selectedKeyframeId,
    payload,
  } as AuthoringOperation;
}

function makeHistory(kind: 'motion.history.undo' | 'motion.history.redo'): AuthoringOperation {
  return {
    schemaVersion: 'motion.operation.v1', operationId: nextOperationId(),
    documentId: authoring.document.documentId, expectedRevision: authoring.document.revision, kind,
  };
}

function nextOperationId(): string {
  operationSequence += 1;
  return `editor:${operationSequence}`;
}

function renderProjection(): void {
  const timeline = buildTimeline(authoring.document);
  const timelineElement = required<HTMLElement>('[data-timeline]');
  timelineElement.dataset.durationMs = String(timeline.durationMs);
  timelineElement.replaceChildren(...timeline.rows.map(renderTrack));
  required('[data-track-count]').textContent = `${timeline.rows.length} tracks`;
  const cues = required('[data-cues]');
  cues.replaceChildren();
  for (const cue of timeline.cues) {
    const button = document.createElement('button');
    button.type = 'button';
    Object.assign(button.dataset, { cueId: cue.id, schemaVersion: cue.schemaVersion, label: cue.label, timeMs: String(cue.timeMs) });
    button.innerHTML = `<span>${cue.label}<code>${cue.id} · ${cue.schemaVersion}</code></span><time>${cue.timeMs} ms</time>`;
    button.addEventListener('click', () => scrub(cue.timeMs));
    cues.append(button);
  }
  required('[data-cue-count]').textContent = String(timeline.cues.length);
  undoButton.disabled = authoring.undo.length === 0;
  redoButton.disabled = authoring.redo.length === 0;
  updateStructuralControls(timeline.rows);
  updateSelection();
}

function updateStructuralControls(rows: TimelineRow[]): void {
  const track = findCreatedTrack(rows);
  const hasTrack = Boolean(track);
  const hasMidpoint = Boolean(track?.keyframes.some((keyframe) => keyframe.offset === 0.5));
  for (const choice of creationChoices) {
    const eligibility = projectTrackCreationEligibility(authoring.document, choice.elementId, 'opacity');
    const radio = required<HTMLInputElement>(`input[name="creation-target"][value="${choice.elementId}"]`);
    radio.disabled = !eligibility.available && selectedCreationElementId !== choice.elementId;
    required(`[data-choice-reason="${choice.elementId}"]`).textContent = eligibility.available
      ? 'Available' : eligibilityReason(eligibility.reason);
  }
  const selectedEligibility = selectedCreationElementId
    ? projectTrackCreationEligibility(authoring.document, selectedCreationElementId, 'opacity') : null;
  createTrackButton.disabled = !selectedEligibility?.available;
  createTrackButton.textContent = selectedCreationElementId
    ? `Create ${creationChoices.find((choice) => choice.elementId === selectedCreationElementId)!.label} opacity track`
    : 'Select a target';
  addMidpointButton.disabled = !hasTrack || hasMidpoint;
  removeMidpointButton.disabled = !hasMidpoint;
  for (const control of [durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton]) {
    control.disabled = !hasTrack;
  }
  required('[data-structural-status]').textContent = !selectedCreationElementId
    ? 'Select an available target to begin.'
    : !hasTrack && selectedEligibility?.available
      ? `${creationChoices.find((choice) => choice.elementId === selectedCreationElementId)!.label} is selected and available.`
      : !hasTrack ? eligibilityReason(selectedEligibility?.reason ?? null)
    : hasMidpoint ? 'Midpoint ready. Adjust timing or remove it.' : 'Track ready. Add a midpoint or adjust timing.';
}

function eligibilityReason(reason: ReturnType<typeof projectTrackCreationEligibility>['reason']): string {
  const reasons = {
    TRACK_ALREADY_EXISTS: 'Already has an opacity track.',
    TRACK_LIMIT_REACHED: 'One created track is allowed in this document.',
    SHARED_PROPERTY_UNSUPPORTED: 'Shared opacity cannot be changed here.',
    PROPERTY_CONFLICT: 'Another opacity binding conflicts with creation.',
    ID_COLLISION: 'Stable track identity is unavailable.',
    DOCUMENT_INVALID: 'The document must be valid before creating a track.',
    ELEMENT_NOT_FOUND: 'The target is no longer in the document.',
    TARGET_PROPERTY_UNSUPPORTED: 'This target and property are not supported.',
  } as const;
  return reason ? reasons[reason] : 'Available';
}

function findCreatedTrack(rows: TimelineRow[]): TimelineRow | undefined {
  return rows.find((row) => creationChoices.some((choice) => choice.elementId === row.elementId)
    && row.property === 'opacity');
}

function diagnosticMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTHORING_DURATION_INVALID: 'Enter a whole-number duration greater than 0.',
    AUTHORING_DELAY_INVALID: 'Enter a whole-number delay of 0 or greater.',
    AUTHORING_TRACK_NOT_FOUND: 'Create the cursor opacity track first.',
  };
  return messages[code] ?? 'That change could not be applied.';
}

function successMessage(kind: AuthoringOperation['kind']): string {
  const messages: Partial<Record<AuthoringOperation['kind'], string>> = {
    'motion.track.create': 'Opacity track created.',
    'motion.keyframe.add': 'Midpoint added.',
    'motion.slot-duration.set': 'Duration updated.',
    'motion.binding-delay.set': 'Delay updated.',
    'motion.slot-easing.set': 'Easing updated.',
    'motion.keyframe.remove': 'Midpoint removed.',
    'motion.history.undo': 'Undid the last change.',
    'motion.history.redo': 'Redid the change.',
  };
  return messages[kind] ?? 'Change applied.';
}

function updateSelection(): void {
  const row = currentTarget();
  const keyframe = row.keyframes.find((candidate) => candidate.id === selectedKeyframeId) ?? row.keyframes[0]!;
  selectedKeyframeId = keyframe.id;
  required('[data-selection]').innerHTML = `
    <div class="selection-summary"><strong>Selected ${row.property} keyframe</strong><span>Revision ${authoring.document.revision}</span></div>
    <div class="selection-chips"><span class="preview-link">Linked to preview</span><code title="${row.elementId}">Element ${shortId(row.elementId)}</code><code title="${keyframe.id}">Keyframe ${shortId(keyframe.id)}</code></div>
    <details class="canonical-ids"><summary>Canonical IDs</summary><code>Element · ${row.elementId}</code><code>Track · ${row.trackId}</code><code>Keyframe · ${keyframe.id}</code></details>`;
  previewSelectionLabel.textContent = `Selected element · ${row.property}`;
  valueInput.value = keyframe.value;
  timeInput.value = String(keyframe.timeMs);
  valueInput.setAttribute('aria-invalid', 'false');
  timeInput.setAttribute('aria-invalid', 'false');
  schedulePreviewSelection();
}

function findEditableTrack(): TimelineRow {
  const timeline = buildTimeline(authoring.document);
  const created = findCreatedTrack(timeline.rows);
  if (created) return created;
  const editable = timeline.rows.filter((row) => row.property === 'opacity'
    && timeline.rows.filter((candidate) => candidate.ruleId === row.ruleId && candidate.property === row.property).length === 1);
  if (editable.length !== 1) throw new Error('EDITOR_EDITABLE_TRACK_AMBIGUOUS');
  return editable[0]!;
}

function currentTarget(): TimelineRow {
  return buildTimeline(authoring.document).rows.find((row) => row.trackId === selectedTrackId)
    ?? findEditableTrack();
}

function scrub(timeMs: number): void {
  controller.scrub(timeMs); scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`;
  schedulePreviewSelection();
}

function renderTrack(row: TimelineRow): HTMLElement {
  const article = document.createElement('article');
  article.className = 'track-row';
  Object.assign(article.dataset, {
    trackId: row.trackId, elementId: row.elementId, property: row.property,
    ruleId: row.ruleId, applicationId: row.applicationId, activeSlotId: row.activeSlotId,
    delayMs: String(row.delayMs), slotCount: String(row.orderedSlotIds.length),
    interpolation: row.interpolation, timing: JSON.stringify(row.timing), timingKind: row.timing.kind,
    keyframeCount: String(row.keyframes.length),
    selected: String(row.trackId === selectedTrackId),
  });
  const timing = row.timing.kind === 'steps' ? `steps(${row.timing.count}, ${row.timing.position})`
    : row.timing.kind === 'keyword' ? row.timing.value : 'cubic-bezier';
  article.innerHTML = `<div class="track-identity"><strong>${row.property}</strong><span>${row.interpolation} motion</span><details class="canonical-ids"><summary>Canonical IDs</summary><code>Element · ${row.elementId}</code><code>Track · ${row.trackId}</code><code>Rule · ${row.ruleId}</code></details></div><div class="track-meta"><span>delay ${row.delayMs} ms</span><span>${timing}</span><span>${row.orderedSlotIds.length} ordered slot${row.orderedSlotIds.length === 1 ? '' : 's'}</span><div class="slots"></div></div><div class="keyframes"></div>`;
  const slotList = article.querySelector('.slots')!;
  for (const slotId of row.orderedSlotIds) {
    const slot = document.createElement('code');
    Object.assign(slot.dataset, { slotId, active: String(slotId === row.activeSlotId) });
    slot.textContent = `${slotId}${slotId === row.activeSlotId ? ' · active' : ''}`; slotList.append(slot);
  }
  const editable = row.trackId === findEditableTrack().trackId;
  const keyframeList = article.querySelector('.keyframes')!;
  for (const keyframe of row.keyframes) {
    const marker = document.createElement('button');
    marker.type = 'button'; marker.className = 'keyframe'; marker.disabled = !editable;
    marker.setAttribute('aria-pressed', String(editable && selectedKeyframeId === keyframe.id));
    Object.assign(marker.dataset, { keyframeId: keyframe.id, offset: String(keyframe.offset), value: keyframe.value, easing: JSON.stringify(keyframe.easing), timeMs: String(keyframe.timeMs) });
    marker.innerHTML = `<strong>${keyframe.timeMs} ms</strong><code>${keyframe.id}</code><span>${keyframe.offset * 100}% · ${keyframe.value} · easing ${keyframe.easing ? JSON.stringify(keyframe.easing) : 'inherited'}</span>`;
    marker.addEventListener('click', () => { selectedTrackId = row.trackId; selectedKeyframeId = keyframe.id; renderProjection(); valueInput.focus(); });
    keyframeList.append(marker);
  }
  return article;
}

function announceInvalidInput(input: HTMLInputElement, label: string): void {
  input.setAttribute('aria-invalid', 'true');
  status.value = `${label}: ${input.validationMessage} Revision ${authoring.document.revision} unchanged.`;
  status.dataset.kind = 'error';
  status.dataset.source = 'validation';
}

function clearValidationFeedback(input: HTMLInputElement): void {
  input.setAttribute('aria-invalid', String(!input.validity.valid));
  if (input.validity.valid && status.dataset.source === 'validation') {
    status.value = `Revision ${authoring.document.revision} ready.`;
    status.dataset.kind = 'ready';
    delete status.dataset.source;
  }
}

function schedulePreviewSelection(): void {
  requestAnimationFrame(updatePreviewSelection);
}

function updatePreviewSelection(): void {
  const row = currentTarget();
  const targetElementId = selectedCreationElementId ?? row.elementId;
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${targetElementId}"]`);
  if (!target) {
    previewSelection.hidden = true;
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const stageRect = previewStage.getBoundingClientRect();
  previewSelection.style.left = `${iframeRect.left - stageRect.left + targetRect.left}px`;
  previewSelection.style.top = `${iframeRect.top - stageRect.top + targetRect.top}px`;
  previewSelection.style.width = `${targetRect.width}px`;
  previewSelection.style.height = `${targetRect.height}px`;
  previewSelection.hidden = false;
}

function shortId(id: string): string {
  return `…${id.slice(-6)}`;
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error('EDITOR_ELEMENT_MISSING');
  return element;
}
