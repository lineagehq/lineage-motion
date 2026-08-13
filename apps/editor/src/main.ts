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
import { MotionServiceClient, makeTrackCreateCommand, type CommitMetadata } from '../../../packages/motion-protocol/src/index.ts';
import './styles.css';

let authoring = createAuthoringState(payload.document);
let compiled = payload.compiled;
const serviceClient = payload.serviceBacked ? new MotionServiceClient('') : null;
let lastCommit: CommitMetadata | null = null;
let immutableRefetchCount = 0;
let pendingRevision: number | null = null;
if (serviceClient) {
  const head = await serviceClient.head(payload.document.documentId);
  authoring = createAuthoringState(head.document);
  compiled = compileMotionDocument(head.document);
}
let operationSequence = 0;
const creationChoices = [
  { elementId: 'el_a2849ff826f3e167', label: 'Cursor' },
  { elementId: 'el_2dbee68b1ea318c8', label: 'Orb' },
] as const;
const statusCopyElementId = 'el_1f3f2908e4fd2401';
let selectedCreationElementId: StructuralAuthoringElementId | null = null;
let selectedTrackId: string | null = null;
let selectedKeyframeId: string | null = null;
let hasExplicitKeyframeSelection = false;

document.body.innerHTML = `
  <main class="editor-shell">
    <header class="topbar">
      <div><p class="eyebrow">Motion Editor</p><h1>Bring one element into motion</h1><p class="purpose">Choose what moves, shape its opacity, set its timing, then preview the compiled CSS.</p></div>
    </header>
    <div class="primary-layout">
      <div class="workflow" aria-label="Animation workflow">
        <section class="workflow-card choose-create" aria-labelledby="choose-create-heading">
          <div class="step-heading"><span>1</span><div><h2 id="choose-create-heading">Choose &amp; Create</h2><p data-structural-status>Select an available element to begin.</p></div></div>
          <fieldset class="target-choices" data-target-choices><legend>What should fade?</legend>
            ${creationChoices.map((choice) => `<label><input type="radio" name="creation-target" value="${choice.elementId}"><span><strong>${choice.label}</strong><small>Opacity · <span data-choice-reason="${choice.elementId}">Available</span></small></span></label>`).join('')}
            <div class="unavailable-choice" data-status-copy><span><strong>Status copy</strong><small>Opacity · <span data-choice-reason="${statusCopyElementId}">Already animated</span></small></span></div>
          </fieldset>
          <button class="primary-action" type="button" data-create-track disabled>Select an element</button>
        </section>
        <section class="workflow-card shape-card" aria-labelledby="shape-heading">
          <div class="step-heading"><span>2</span><div><h2 id="shape-heading">Shape</h2><p>Add a midpoint for a softer fade, or edit exact keyframes in Inspect.</p></div></div>
          <div class="shape-actions"><button type="button" data-add-midpoint>Add midpoint</button><button type="button" data-remove-midpoint>Remove midpoint</button></div>
          <div class="authoring-panel" aria-label="Selected keyframe authoring">
            <div class="selection" data-selection></div>
            <div class="keyframe-fields">
              <form data-value-form><label>Opacity value <input data-value type="number" min="0" max="1" step="0.000001" required disabled></label><button type="submit" disabled>Set value</button></form>
              <form data-time-form><label>Master time (ms) <input data-time type="number" min="0" step="1" required disabled></label><button type="submit" disabled>Set time</button></form>
            </div>
          </div>
        </section>
        <section class="workflow-card timing-card" aria-labelledby="time-heading">
          <div class="step-heading"><span>3</span><div><h2 id="time-heading">Time</h2><p>Applied values are canonical. Draft fields do not change the preview until applied.</p></div></div>
          <div class="timing-controls">
            <div class="timing-control"><output data-applied-duration>Applied — create a track first</output><label><span>Duration draft <em hidden>Not applied</em></span><input data-duration type="number" min="1" step="1" value="1000"></label><button type="button" data-set-duration>Apply duration</button></div>
            <div class="timing-control"><output data-applied-delay>Applied — create a track first</output><label><span>Delay draft <em hidden>Not applied</em></span><input data-delay type="number" min="0" step="1" value="610"></label><button type="button" data-set-delay>Apply delay</button></div>
            <div class="timing-control"><output data-applied-easing>Applied — create a track first</output><label><span>Easing draft <em hidden>Not applied</em></span><select data-easing><option value="linear">linear</option><option value="ease-in-out">ease-in-out</option></select></label><button type="button" data-set-easing>Apply easing</button></div>
          </div>
          <div class="hold-control" data-hold-control>
            <div><strong>Extend the reveal beat</strong><span>Insert one fixed 600 ms hold before Pair crosses. Every later cue and motion beat ripples together.</span></div>
            <button type="button" data-insert-hold>Insert 600 ms hold</button>
            <output data-hold-status>No hold inserted · Pair crosses at 2870 ms</output>
          </div>
        </section>
        <section class="workflow-footer" aria-label="Change history">
          <div class="history"><button type="button" data-undo>Undo</button><button type="button" data-redo>Redo</button></div>
          <output class="operation-status" data-operation-status role="status" aria-live="polite">Revision 0 ready.</output>
        </section>
      </div>
      <section class="preview-panel" aria-labelledby="preview-heading">
        <div class="preview-title"><div><span>4</span><div><h2 id="preview-heading">Preview</h2><p>Exact compiler output · native CSS animation</p></div></div><span data-preview-selection-label></span></div>
        <div class="preview-stage"><iframe data-preview title="Compiled motion preview"></iframe><div class="preview-selection" data-preview-selection hidden><span>Selected element</span></div></div>
        <div class="transport" aria-label="Preview transport">
          <button type="button" data-play>Play</button><button type="button" data-pause>Pause</button>
          <label>Preview time <input data-scrub type="range" min="0" max="${authoring.document.durationMs}" step="1" value="0"></label>
          <output data-playhead>0 ms</output>
        </div>
      </section>
    </div>
    <details class="inspect-panel">
      <summary><span><strong>Inspect all tracks</strong><small>Complete timeline, cues, keyframes, stable IDs, and reduced motion</small></span><span data-track-count></span></summary>
      <div class="inspection-content">
        <aside class="cue-panel" aria-label="Narrative cues"><div class="panel-heading"><span>Narrative cues</span><span data-cue-count></span></div><div data-cues class="cue-list"></div></aside>
        <section class="timeline-panel" aria-label="Master timeline"><div data-timeline class="timeline"></div></section>
        <button class="reduced-toggle" type="button" data-reduced-toggle aria-expanded="false">Inspect reduced motion</button>
        <section data-reduced-motion-panel data-mode="${authoring.document.reducedMotion.mode}" data-css="${authoring.document.reducedMotion.css}" class="reduced-panel" hidden>
          <strong>source-snapshot</strong><p>Inspection only. The canonical document and compiler output remain unchanged.</p><pre></pre>
        </section>
      </div>
    </details>
  </main>`;

const iframe = required<HTMLIFrameElement>('[data-preview]');
const controller = new NativePreviewController(iframe);
const scrubber = required<HTMLInputElement>('[data-scrub]');
const playhead = required<HTMLOutputElement>('[data-playhead]');
const status = required<HTMLOutputElement>('[data-operation-status]');
const valueInput = required<HTMLInputElement>('[data-value]');
const timeInput = required<HTMLInputElement>('[data-time]');
const valueButton = required<HTMLButtonElement>('[data-value-form] button');
const timeButton = required<HTMLButtonElement>('[data-time-form] button');
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
const appliedDuration = required<HTMLOutputElement>('[data-applied-duration]');
const appliedDelay = required<HTMLOutputElement>('[data-applied-delay]');
const appliedEasing = required<HTMLOutputElement>('[data-applied-easing]');
const insertHoldButton = required<HTMLButtonElement>('[data-insert-hold]');
const holdStatus = required<HTMLOutputElement>('[data-hold-status]');

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
undoButton.addEventListener('click', () => {
  if (authoring.undo.length === 0) return;
  void dispatch(makeHistory('motion.history.undo'), '[data-undo]', {
    viewportTop: undoButton.getBoundingClientRect().top, scrollY,
  });
});
redoButton.addEventListener('click', () => {
  if (authoring.redo.length === 0) return;
  void dispatch(makeHistory('motion.history.redo'), '[data-redo]', {
    viewportTop: redoButton.getBoundingClientRect().top, scrollY,
  });
});
createTrackButton.addEventListener('click', () => {
  if (!selectedCreationElementId) return;
  const elementId = selectedCreationElementId;
  void dispatch({
  ...operationEnvelope(), kind: 'motion.track.create', elementId,
  payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 },
  } as AuthoringOperation, '[data-add-midpoint]');
});
addMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.add', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { timeMs: 1110, value: 0.5 },
}), '[data-value]'));
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
insertHoldButton.addEventListener('click', () => void dispatch({
  ...operationEnvelope(), kind: 'motion.hold.insert',
  payload: { cueId: 'cue_pair', durationMs: 600 },
}, '[data-undo]'));
removeMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.remove', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  keyframeId: track.keyframes.find((keyframe) => keyframe.offset === 0.5)?.id ?? '',
}), '[data-add-midpoint]'));
for (const [selector, label] of [['[data-duration]', 'Duration'], ['[data-delay]', 'Delay']] as const) {
  const input = required<HTMLInputElement>(selector);
  input.addEventListener('invalid', () => announceInvalidInput(input, label));
  input.addEventListener('input', () => clearValidationFeedback(input));
}
for (const control of [durationInput, delayInput, easingInput]) {
  control.addEventListener('input', () => updateTimingDraftState(control));
  control.addEventListener('change', () => updateTimingDraftState(control));
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
    selectedTrackId: selectedTrackId as string,
    selectedKeyframeId: selectedKeyframeId as string,
    selectedCreationElementId,
    serviceBacked: Boolean(serviceClient),
    immutableRefetchCount,
    lastCommit,
  }),
  dispatch,
};

async function dispatch(
  operation: AuthoringOperation,
  focusSelector?: string,
  historyAnchor?: { viewportTop: number; scrollY: number },
): Promise<{ ok: boolean; code?: string }> {
  const beforeCreated = findCreatedTrack(buildTimeline(authoring.document).rows);
  const beforeHasMidpoint = beforeCreated?.keyframes.some((keyframe) => keyframe.offset === 0.5) ?? false;
  if (serviceClient && operation.kind !== 'motion.track.create') {
    const code = 'SERVICE_OPERATION_UNSUPPORTED';
    status.value = `This durable editor currently supports track creation only. (${code}) Revision ${authoring.document.revision} unchanged.`;
    status.dataset.kind = 'error'; return { ok: false, code };
  }
  let result = dispatchAuthoringOperation(authoring, operation);
  if (serviceClient && operation.kind === 'motion.track.create') {
    pendingRevision = operation.expectedRevision + 1;
    const response = await serviceClient.dispatch(makeTrackCreateCommand({ operationId: operation.operationId,
      documentId: operation.documentId, expectedRevision: operation.expectedRevision, elementId: operation.elementId }));
    if (!response.ok) {
      pendingRevision = null;
      if (response.code === 'STALE_REVISION') {
        const immutable = await serviceClient.head(operation.documentId);
        immutableRefetchCount += 1;
        authoring = createAuthoringState(immutable.document);
        compiled = compileMotionDocument(authoring.document);
        await controller.mount(compiled.html);
        renderProjection();
      }
      const code = response.code === 'STALE_REVISION' ? 'AUTHORING_STALE_REVISION' : `SERVICE_${response.code}`;
      status.value = response.code === 'STALE_REVISION'
        ? `${diagnosticMessage(code)} (${code}) Local operation not applied; refreshed to revision ${authoring.document.revision}.`
        : `${diagnosticMessage(code)} (${code}) Revision ${authoring.document.revision} unchanged.`;
      status.dataset.kind = 'error'; return { ok: false, code };
    }
    const immutable = await serviceClient.revision(response.documentId, response.resultingRevision);
    immutableRefetchCount += 1;
    authoring = createAuthoringState(immutable.document);
    pendingRevision = null;
    result = { ok: true, state: authoring };
  }
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
  const rows = buildTimeline(authoring.document).rows;
  const created = findCreatedTrack(rows);
  const hasMidpoint = created?.keyframes.some((keyframe) => keyframe.offset === 0.5) ?? false;
  if (created) {
    selectedTrackId = created.trackId;
    if (operation.kind === 'motion.keyframe.add') {
      selectedKeyframeId = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
      hasExplicitKeyframeSelection = true;
    } else if (operation.kind === 'motion.keyframe.remove') {
      selectedKeyframeId = created.keyframes.at(-1)!.id;
    } else if (operation.kind === 'motion.track.create'
      || !created.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)) {
      selectedKeyframeId = created.keyframes[0]!.id;
    }
  } else {
    const selectedStillExists = selectedTrackId && selectedKeyframeId
      && rows.find((row) => row.trackId === selectedTrackId)
        ?.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId);
    if (!selectedStillExists) {
      selectedTrackId = null;
      selectedKeyframeId = null;
    }
  }
  if (operation.kind === 'motion.history.undo'
    && ((beforeHasMidpoint && !hasMidpoint) || (beforeCreated && !created))) {
    clearKeyframeSelection();
  } else if (operation.kind === 'motion.history.redo' && !beforeCreated && created) {
    selectedTrackId = created.trackId;
    selectedKeyframeId = created.keyframes[0]!.id;
    hasExplicitKeyframeSelection = true;
  } else if (operation.kind === 'motion.history.redo' && !beforeHasMidpoint && hasMidpoint && created) {
    selectedTrackId = created.trackId;
    selectedKeyframeId = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
    hasExplicitKeyframeSelection = true;
  }
  renderProjection();
  status.value = `${successMessage(operation.kind)} Revision ${authoring.document.revision}.`;
  status.dataset.kind = 'success';
  if (focusSelector) {
    const focusTarget = required<HTMLElement>(focusSelector);
    if (focusTarget instanceof HTMLButtonElement && focusTarget.disabled) {
      focusTarget.disabled = false;
      focusTarget.setAttribute('aria-disabled', 'true');
    }
    focusTarget.focus({ preventScroll: true });
    if (historyAnchor) {
      scrollBy(0, focusTarget.getBoundingClientRect().top - historyAnchor.viewportTop);
      Object.assign(focusTarget.dataset, {
        historyViewportTopBefore: String(historyAnchor.viewportTop),
        historyViewportTopAfter: String(focusTarget.getBoundingClientRect().top),
        historyScrollBefore: String(historyAnchor.scrollY),
        historyScrollAfter: String(scrollY),
        historyMaxScrollAfter: String(document.documentElement.scrollHeight - innerHeight),
      });
    }
  }
  return { ok: true };
}

if (serviceClient) {
  serviceClient.events(authoring.document.documentId, async (event) => {
    if (event.revision <= authoring.document.revision || event.revision === pendingRevision) { lastCommit = event; return; }
    const immutable = await serviceClient.revision(event.documentId, event.revision);
    immutableRefetchCount += 1; lastCommit = event;
    authoring = createAuthoringState(immutable.document);
    compiled = compileMotionDocument(authoring.document);
    await controller.mount(compiled.html);
    renderProjection();
    status.value = `Revision ${authoring.document.revision} refreshed from committed service state.`;
  });
}

function clearKeyframeSelection(): void {
  selectedTrackId = null;
  selectedKeyframeId = null;
  hasExplicitKeyframeSelection = false;
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
  scrubber.max = String(timeline.durationMs);
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
  const hold = timeline.holds?.[0];
  insertHoldButton.disabled = Boolean(hold);
  holdStatus.value = hold
    ? `600 ms hold inserted · Pair crosses at ${hold.sourceTimeMs + hold.durationMs} ms · duration ${timeline.durationMs} ms`
    : 'No hold inserted · Pair crosses at 2870 ms';
  required<HTMLElement>('[data-hold-control]').dataset.active = String(Boolean(hold));
  for (const [button, unavailable] of [[undoButton, authoring.undo.length === 0],
    [redoButton, authoring.redo.length === 0]] as const) {
    button.removeAttribute('aria-disabled');
    button.disabled = unavailable;
  }
  updateStructuralControls(timeline.rows);
  updateSelection();
}

function updateStructuralControls(rows: TimelineRow[]): void {
  const locked = (authoring.document.holds ?? []).length > 0;
  const track = findCreatedTrack(rows);
  const hasTrack = Boolean(track);
  const hasMidpoint = Boolean(track?.keyframes.some((keyframe) => keyframe.offset === 0.5));
  for (const choice of creationChoices) {
    const eligibility = projectTrackCreationEligibility(authoring.document, choice.elementId, 'opacity');
    const radio = required<HTMLInputElement>(`input[name="creation-target"][value="${choice.elementId}"]`);
    radio.disabled = locked || (!eligibility.available && selectedCreationElementId !== choice.elementId);
    required(`[data-choice-reason="${choice.elementId}"]`).textContent = eligibility.available
      ? 'Available' : eligibilityReason(eligibility.reason);
  }
  const selectedEligibility = selectedCreationElementId
    ? projectTrackCreationEligibility(authoring.document, selectedCreationElementId, 'opacity') : null;
  createTrackButton.disabled = locked || !selectedEligibility?.available;
  createTrackButton.textContent = selectedCreationElementId
    ? `Create ${creationChoices.find((choice) => choice.elementId === selectedCreationElementId)!.label} opacity track`
    : 'Select an element';
  addMidpointButton.disabled = locked || !hasTrack || hasMidpoint;
  removeMidpointButton.disabled = locked || !hasMidpoint;
  for (const control of [durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton]) {
    control.disabled = locked || !hasTrack;
  }
  hydrateTimingControls(track);
  required('[data-structural-status]').textContent = locked
    ? 'Hold inserted. Undo the hold before making another edit.' : !selectedCreationElementId
    ? 'Select an available element to begin.'
    : !hasTrack && selectedEligibility?.available
      ? `${creationChoices.find((choice) => choice.elementId === selectedCreationElementId)!.label} is ready to animate.`
      : !hasTrack ? eligibilityReason(selectedEligibility?.reason ?? null)
    : hasMidpoint ? 'Midpoint ready. Adjust timing or remove it.' : 'Track ready. Add a midpoint or adjust timing.';
}

function hydrateTimingControls(track: TimelineRow | undefined): void {
  if (!track) {
    durationInput.value = '1000'; delayInput.value = '610'; easingInput.value = 'linear';
    appliedDuration.value = 'Applied — create a track first';
    appliedDelay.value = 'Applied — create a track first';
    appliedEasing.value = 'Applied — create a track first';
  } else {
    const durationMs = track.keyframes.at(-1)!.timeMs - track.keyframes[0]!.timeMs;
    const easing = track.timing.kind === 'keyword' ? track.timing.value : JSON.stringify(track.timing);
    durationInput.value = String(durationMs); delayInput.value = String(track.delayMs); easingInput.value = easing;
    appliedDuration.value = `Applied · ${durationMs} ms`;
    appliedDelay.value = `Applied · ${track.delayMs} ms`;
    appliedEasing.value = `Applied · ${easing}`;
  }
  for (const control of [durationInput, delayInput, easingInput]) {
    control.closest('.timing-control')?.setAttribute('data-draft', 'false');
    required<HTMLElement>('em', control.closest('.timing-control')!).hidden = true;
  }
  durationInput.setAttribute('aria-invalid', 'false');
  delayInput.setAttribute('aria-invalid', 'false');
}

function updateTimingDraftState(control: HTMLInputElement | HTMLSelectElement): void {
  const track = findCreatedTrack(buildTimeline(authoring.document).rows);
  let appliedValue: string | undefined;
  if (track) {
    if (control === durationInput) {
      appliedValue = String(track.keyframes.at(-1)!.timeMs - track.keyframes[0]!.timeMs);
    } else if (control === delayInput) {
      appliedValue = String(track.delayMs);
    } else {
      appliedValue = track.timing.kind === 'keyword' ? track.timing.value : JSON.stringify(track.timing);
    }
  }
  const differs = appliedValue !== undefined && control.value !== appliedValue;
  const container = control.closest<HTMLElement>('.timing-control')!;
  container.dataset.draft = String(differs);
  required<HTMLElement>('em', container).hidden = !differs;
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
    AUTHORING_HOLD_LOCKED: 'Undo the hold before making another edit.',
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
    'motion.hold.insert': '600 ms hold inserted before Pair crosses.',
    'motion.history.undo': 'Undid the last change.',
    'motion.history.redo': 'Redid the change.',
  };
  return messages[kind] ?? 'Change applied.';
}

function updateSelection(): void {
  const row = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((candidate) => candidate.trackId === selectedTrackId) : undefined;
  const keyframe = row?.keyframes.find((candidate) => candidate.id === selectedKeyframeId);
  if (!row || !keyframe) clearKeyframeSelection();
  const locked = (authoring.document.holds ?? []).length > 0;
  valueInput.disabled = locked || !hasExplicitKeyframeSelection;
  timeInput.disabled = locked || !hasExplicitKeyframeSelection;
  valueButton.disabled = locked || !hasExplicitKeyframeSelection;
  timeButton.disabled = locked || !hasExplicitKeyframeSelection;
  if (!hasExplicitKeyframeSelection) {
    required('[data-selection]').innerHTML = `<div class="selection-summary"><strong>No keyframe selected</strong><span>Open Inspect all tracks and choose a keyframe for exact editing.</span></div>`;
    previewSelectionLabel.textContent = selectedCreationElementId ? 'Element chosen' : '';
    schedulePreviewSelection();
    return;
  }
  selectedKeyframeId = keyframe!.id;
  required('[data-selection]').innerHTML = `
    <div class="selection-summary"><strong>Selected ${row!.property} keyframe</strong><span>Revision ${authoring.document.revision}</span></div>
    <div class="selection-chips"><span class="preview-link">Linked to preview</span></div>
    <details class="canonical-ids"><summary>Canonical IDs</summary><code>Element · ${row!.elementId}</code><code>Track · ${row!.trackId}</code><code>Keyframe · ${keyframe!.id}</code></details>`;
  previewSelectionLabel.textContent = `Selected element · ${row!.property}`;
  valueInput.value = keyframe!.value;
  timeInput.value = String(keyframe!.timeMs);
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
  const selected = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((row) => row.trackId === selectedTrackId) : undefined;
  if (!selected || !selectedKeyframeId || !selected.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)) {
    throw new Error('EDITOR_KEYFRAME_SELECTION_MISSING');
  }
  return selected;
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
    marker.addEventListener('click', () => { selectedTrackId = row.trackId; selectedKeyframeId = keyframe.id; hasExplicitKeyframeSelection = true; renderProjection(); valueInput.focus({ preventScroll: true }); });
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
  const selectedRow = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((row) => row.trackId === selectedTrackId) : undefined;
  const targetElementId = selectedCreationElementId ?? selectedRow?.elementId;
  if (!targetElementId) {
    previewSelection.hidden = true;
    return;
  }
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

function required<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error('EDITOR_ELEMENT_MISSING');
  return element;
}
