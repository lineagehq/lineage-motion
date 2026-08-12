import payload from 'virtual:motion-document';
import { compileMotionDocument } from '../../../packages/css-compiler/src/index.js';
import {
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  sha256Hex,
  type AuthoringOperation,
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
const previewStage = required<HTMLElement>('.preview-stage');
const previewSelection = required<HTMLElement>('[data-preview-selection]');
const previewSelectionLabel = required<HTMLElement>('[data-preview-selection-label]');

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
  }),
  dispatch,
};

async function dispatch(operation: AuthoringOperation): Promise<{ ok: boolean; code?: string }> {
  const result = dispatchAuthoringOperation(authoring, operation);
  if (!result.ok) {
    status.value = `${result.diagnostic.code}: operation rejected; revision ${authoring.document.revision} unchanged.`;
    status.dataset.kind = 'error';
    return { ok: false, code: result.diagnostic.code };
  }
  authoring = result.state;
  compiled = compileMotionDocument(authoring.document);
  await controller.mount(compiled.html);
  renderProjection();
  status.value = `${operation.kind} applied. Revision ${authoring.document.revision}.`;
  status.dataset.kind = 'success';
  return { ok: true };
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
  updateSelection();
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
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${row.elementId}"]`);
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
