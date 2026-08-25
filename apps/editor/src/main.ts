import payload from 'virtual:motion-document';
import { compileMotionDocument } from '../../../packages/css-compiler/src/index.js';
import {
  canonicalJson,
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  projectShotWorkspace,
  projectTrajectorySelection,
  projectTransformTrajectory,
  projectTrackCreationEligibility,
  sha256Hex,
  type AuthoringOperation,
  type StructuralAuthoringElementId,
  type TimingFunction,
} from '../../../packages/domain/src/index.js';
import {
  buildTimeline,
  createPreviewOverlayProjection,
  previewPointerDeltaToPpm,
  NativePreviewController,
  projectContentBounds,
  type PreviewOverlayProjection,
  type PreviewCssCommitPromotion,
  type ProjectionRect,
  type TimelineRow,
} from '../../../packages/preview-runtime/src/index.js';
import { MotionServiceClient, makeBranchCreateCommand, makeClaimControlCommand, makeTrackCreateCommand, makeTrajectoryCommand,
  type CommitMetadata } from '../../../packages/motion-protocol/src/index.ts';
import './styles.css';

let authoring = createAuthoringState(payload.document);
let compiled = payload.compiled;
const serviceClient = payload.serviceBacked && payload.humanCapability
  ? new MotionServiceClient('', (...args) => fetch(...args), { actor: 'human', capability: payload.humanCapability })
  : payload.serviceBacked ? (() => { throw new Error('EDITOR_CAPABILITY_REQUIRED'); })() : null;
let lastCommit: CommitMetadata | null = null;
let immutableRefetchCount = 0;
let pendingRevision: number | null = null;
let durableTrajectoryUndoCount = 0;
let durableTrajectoryRedoCount = 0;
let activeBranchId = 'main';
if (serviceClient) {
  const head = await serviceClient.head(payload.document.documentId);
  authoring = createAuthoringState(head.document);
  compiled = compileMotionDocument(head.document);
}
const operationClientId = crypto.randomUUID();
let operationSequence = 0;
const creationChoices = [
  { elementId: 'el_a2849ff826f3e167', label: 'Cursor' },
  { elementId: 'el_2dbee68b1ea318c8', label: 'Orb' },
] as const;
const statusCopyElementId = 'el_1f3f2908e4fd2401';
let selectedCreationElementId: StructuralAuthoringElementId | null = null;
let creationDraftDirty = false;
let selectedTrackId: string | null = null;
let selectedKeyframeId: string | null = null;
let hasExplicitKeyframeSelection = false;
let unavailableSelection = false;
let unavailableCreation = false;
let lastCommitSeq = 0;
let reconciliation = Promise.resolve();
let branchGeneration = 0;
let eventSubscription: { close(): void } | null = null;
let eventSubscriptionGeneration = 0;
const reconciliationFailures = new Map<number, number>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let draftConflictRevision: number | null = null;
let draftStaleBaseRevision: number | null = null;

document.body.innerHTML = `
  <main class="editor-shell">
    <header class="topbar">
      <div><p class="eyebrow">Motion Editor</p><h1>Bring one element into motion</h1><p class="purpose">Choose what moves, shape its opacity, set its timing, then preview the compiled CSS.</p></div>
      ${serviceClient ? `<section class="branch-controls" aria-label="Branches and claims">
        <label>Active branch <select data-active-branch><option value="main">main</option></select></label>
        <form data-branch-form><label>New branch <input data-new-branch value="feature" pattern="[A-Za-z0-9_]+"></label><button type="submit">Create branch</button></form>
        <form data-revoke-form><label>Claim ID <input data-claim-id placeholder="claim_…"></label><label>Lease version <input data-lease-version type="number" min="1" value="1"></label><button type="submit">Revoke claim</button></form>
      </section>` : ''}
    </header>
    <section class="shot-workspace" data-shot-workspace hidden aria-labelledby="shot-workspace-heading">
      <header><div><p class="eyebrow">Shot 1 · 0–2100 ms</p><h2 id="shot-workspace-heading">Animate on one canvas</h2><p>Select an object and moment, then drag it directly. Use the two handles for scale and rotation.</p></div></header>
      <div class="shot-grid"><fieldset data-shot-targets><legend>Object</legend></fieldset><button class="path-toggle" type="button" data-shot-mode="path" aria-pressed="true">Path</button><label class="move-together"><input type="checkbox" data-move-together><span><strong>Move together</strong><small>Translation only; scale and rotation stay on the selected object.</small></span></label></div>
      <p class="shot-guidance" data-shot-guidance role="note"></p>
      <fieldset class="shot-moments" data-shot-moments><legend>Moment</legend></fieldset>
      <details class="shot-advanced" data-shot-advanced><summary>Advanced</summary><div class="advanced-content">
        <form class="pose-fields" data-pose-form><label>X (px)<input name="x" type="number" step="0.000001" required></label><label>Y (px)<input name="y" type="number" step="0.000001" required></label><label>Scale<input name="scale" type="number" step="0.000001" min="0.25" max="3" required></label><label>Rotation (deg)<input name="rotate" type="number" step="0.000001" min="-180" max="180" required></label><button type="submit">Apply pose</button></form>
        <div class="shot-timing"><label>Landing (ms)<input data-shot-landing type="number" min="1" max="2099" value="700"></label><button type="button" data-shot-apply-time>Apply times</button><label>Incoming easing<select data-shot-easing><option>ease-out</option><option>ease-in</option><option>ease-in-out</option><option>linear</option></select></label><button type="button" data-shot-apply-easing>Apply easing</button><label>Settled (ms)<input data-shot-settled type="number" min="2" max="2100" value="2100"></label><button type="button" data-shot-hold>Create settled hold</button></div>
      </div></details>
      <div class="shot-history-slot" data-shot-history-slot></div>
      <output data-shot-status role="status" aria-live="polite"></output>
      <section class="shot-recovery" data-shot-recovery hidden aria-labelledby="shot-recovery-heading">
        <div><strong id="shot-recovery-heading">Manual Shot editing is unavailable</strong><span data-shot-recovery-copy></span></div>
        <div><button type="button" data-shot-retry>Retry Shot workspace</button><button type="button" data-shot-inspect>Open track inspector</button></div>
      </section>
    </section>
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
        <div class="preview-shot-toolbar" data-preview-shot-toolbar hidden>
          <div class="preview-shot-context"><strong data-preview-shot-object>Object 1</strong><output data-preview-shot-state>Editing 700 ms</output></div>
          <div class="preview-shot-actions" data-preview-shot-actions role="group" aria-label="Preview-side Shot controls"></div>
        </div>
        <div class="preview-stage"><div class="preview-canvas" data-preview-canvas><iframe data-preview title="Compiled motion preview"></iframe><div class="preview-object-overlay" data-preview-object-overlay aria-label="Selectable preview objects"></div><div class="preview-selection" data-preview-selection hidden><span>Selected element</span></div><div class="trajectory-overlay" data-trajectory-overlay aria-label="Compiler-native trajectory waypoints"></div></div></div>
        <div class="transport" aria-label="Preview transport">
          <button type="button" data-play>Play</button><button type="button" data-pause>Pause</button>
          <label>Preview time <input data-scrub type="range" min="0" max="${authoring.document.durationMs}" step="1" value="0"></label>
          <output data-playhead>0 ms</output>
        </div>
      </section>
    </div>
    <section class="draft-conflict" data-draft-conflict hidden role="alert"><div><strong>Remote revision available</strong><span>Your unsubmitted draft is still here and has not been applied. Choose how to resolve it.</span></div><button type="button" data-keep-draft>Keep draft</button><button type="button" data-discard-draft>Discard draft</button></section>
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
const previewCanvas = required<HTMLElement>('[data-preview-canvas]');
const previewObjectOverlay = required<HTMLElement>('[data-preview-object-overlay]');
const previewSelection = required<HTMLElement>('[data-preview-selection]');
const previewShotToolbar = required<HTMLElement>('[data-preview-shot-toolbar]');
const previewShotObject = required<HTMLElement>('[data-preview-shot-object]');
const previewShotState = required<HTMLOutputElement>('[data-preview-shot-state]');
const previewShotActions = required<HTMLElement>('[data-preview-shot-actions]');
const branchSelect = document.querySelector<HTMLSelectElement>('[data-active-branch]');
const branchForm = document.querySelector<HTMLFormElement>('[data-branch-form]');
const revokeForm = document.querySelector<HTMLFormElement>('[data-revoke-form]');
const draftConflict = required<HTMLElement>('[data-draft-conflict]');
const shotWorkspace = required<HTMLElement>('[data-shot-workspace]');
const shotTargets = required<HTMLFieldSetElement>('[data-shot-targets]');
const shotMoments = required<HTMLFieldSetElement>('[data-shot-moments]');
const shotOverlay = required<HTMLElement>('[data-trajectory-overlay]');
const shotPoseForm = required<HTMLFormElement>('[data-pose-form]');
const shotStatus = required<HTMLOutputElement>('[data-shot-status]');
const shotGuidance = required<HTMLElement>('[data-shot-guidance]');
const shotRecovery = required<HTMLElement>('[data-shot-recovery]');
let shotConfig: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] } | null = null;
let shotSelection: string[] = [];
let shotPrimaryElementId: string | null = null;
let shotMomentMs = 700;
let shotMode: 'pose' | 'path' = 'path';
let shotProjection: PreviewOverlayProjection | null = null;
let shotGeometry: Array<{ elementId: string; timeMs: number; contentBounds: ProjectionRect; overlayBounds: ProjectionRect;
  deltasDevicePixels: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number } }> = [];
let shotGeometryGeneration = 0;
type ShotGeometryRequest = { requestId: number; workspaceGeneration: number; primaryElementId: string;
  geometryKey: string; waypoints: Array<{ keyframeId: string; timeMs: number }>;
  paths: Array<{ elementId: string; objectIndex: number; waypoints: Array<{ keyframeId: string; timeMs: number }> }>;
  requestedTimes: number[] };
let shotGeometryRequestId = 0;
let latestShotGeometryRequest: ShotGeometryRequest | null = null;
let pendingShotGeometryRequest: ShotGeometryRequest | null = null;
let shotGeometryPumpRunning = false;
let shotGeometryPumpCompletion = Promise.resolve();
let activeShotGeometrySamplers = 0;
let maximumActiveShotGeometrySamplers = 0;
let lastCommittedShotGeometryRequestId: number | null = null;
let committedShotGeometryKey: string | null = null;
let mountedPreviewGeneration = 0;
let activeWaypointDraft: {
  operation: AuthoringOperation;
  commandBytes: string;
  compiledHtml: string;
  compiledCss: string;
  exportDigest: string;
} | null = null;
let waypointDraftApply = Promise.resolve();
let waypointDraftFrame: number | null = null;
let waypointDraftMoveCount = 0;
let waypointDraftAppliedCount = 0;
let waypointDraftFailure: string | null = null;
let waypointGestureGeneration = 0;
let waypointReleasePhase: 'idle' | 'flushing-latest' | 'committing' | 'publishing-geometry' = 'idle';
let playbackFeedbackFrame: number | null = null;
let lastPreviewCommitPromotion: { schemaVersion: 'motion.preview-css-commit-promotion.v1'; attempted: boolean;
  promoted: boolean; fallbackCode: string | null } = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: false,
    promoted: false, fallbackCode: null };
required<HTMLButtonElement>('[data-keep-draft]').addEventListener('click', () => resolveDraftConflict(true));
required<HTMLButtonElement>('[data-discard-draft]').addEventListener('click', () => resolveDraftConflict(false));
for (const button of shotWorkspace.querySelectorAll<HTMLButtonElement>('[data-shot-mode]')) button.addEventListener('click', () => {
  selectShotMode(shotMode === 'path' ? 'pose' : 'path');
});
required<HTMLInputElement>('[data-move-together]').addEventListener('change', (event) => {
  const editBoth = event.currentTarget as HTMLInputElement;
  shotSelection = editBoth.checked && shotConfig ? [...shotConfig.targetElementIds] : shotPrimaryElementId ? [shotPrimaryElementId] : [];
  renderShotWorkspace();
});
shotPoseForm.addEventListener('submit', (event) => { event.preventDefault(); void applyShotPose(); });
required<HTMLButtonElement>('[data-shot-apply-time]').addEventListener('click', () => void applyShotTimes());
required<HTMLButtonElement>('[data-shot-apply-easing]').addEventListener('click', () => void applyShotEasing());
required<HTMLButtonElement>('[data-shot-hold]').addEventListener('click', () => void applyShotHold());
required<HTMLButtonElement>('[data-shot-retry]').addEventListener('click', () => initializeSeedWorkspace());
required<HTMLButtonElement>('[data-shot-inspect]').addEventListener('click', () => {
  const inspector = required<HTMLDetailsElement>('.inspect-panel'); inspector.open = true; inspector.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
for (const input of document.querySelectorAll<HTMLInputElement>('[data-shot-landing], [data-shot-settled]')) {
  input.addEventListener('input', () => {
    for (const timingInput of document.querySelectorAll<HTMLInputElement>('[data-shot-landing], [data-shot-settled]')) {
      timingInput.setCustomValidity(''); timingInput.removeAttribute('aria-invalid');
    }
    shotStatus.value = `Timing draft not applied · revision ${authoring.document.revision} unchanged.`;
  });
}
for (const control of document.querySelectorAll<HTMLInputElement>('[data-new-branch], [data-claim-id], [data-lease-version]')) {
  control.addEventListener('input', () => { control.dataset.draft = String(control.value !== control.defaultValue); });
}

branchSelect?.addEventListener('change', () => void switchBranch(branchSelect.value));
branchForm?.addEventListener('submit', (event) => { event.preventDefault(); void createBranch(
  required<HTMLInputElement>('[data-new-branch]').value); });
revokeForm?.addEventListener('submit', (event) => { event.preventDefault(); void revokeClaim(
  required<HTMLInputElement>('[data-claim-id]').value, Number(required<HTMLInputElement>('[data-lease-version]').value)); });
const previewSelectionLabel = required<HTMLElement>('[data-preview-selection-label]');
const appliedDuration = required<HTMLOutputElement>('[data-applied-duration]');
const appliedDelay = required<HTMLOutputElement>('[data-applied-delay]');
const appliedEasing = required<HTMLOutputElement>('[data-applied-easing]');
const insertHoldButton = required<HTMLButtonElement>('[data-insert-hold]');
const holdStatus = required<HTMLOutputElement>('[data-hold-status]');

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) {
  radio.addEventListener('change', () => {
    selectedCreationElementId = radio.value as StructuralAuthoringElementId;
    creationDraftDirty = true;
    updateStructuralControls(buildTimeline(authoring.document).rows);
    schedulePreviewSelection();
  });
}

required<HTMLButtonElement>('[data-play]').addEventListener('click', () => {
  if (!shotConfig) previewSelection.hidden = true;
  controller.play();
  startPlaybackFeedback();
  republishShotGeometry();
});
required<HTMLButtonElement>('[data-pause]').addEventListener('click', () => {
  controller.pause();
  stopPlaybackFeedback(); syncPlaybackFeedback();
  republishShotGeometry();
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
valueInput.addEventListener('input', () => { valueInput.dataset.draft = 'true'; });
timeInput.addEventListener('input', () => { timeInput.dataset.draft = 'true'; });
undoButton.addEventListener('click', () => {
  if ((serviceClient ? durableTrajectoryUndoCount : authoring.undo.length) === 0) return;
  void dispatch(makeHistory('motion.history.undo'), '[data-undo]', {
    viewportTop: undoButton.getBoundingClientRect().top, scrollY,
  });
});
redoButton.addEventListener('click', () => {
  if ((serviceClient ? durableTrajectoryRedoCount : authoring.redo.length) === 0) return;
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
await mountPreview(compiled.html, compiled.css);
initializeSeedWorkspace();
schedulePreviewSelection();
document.querySelector('main')!.setAttribute('data-editor-ready', 'true');
window.addEventListener('resize', () => { configurePreviewCanvas(); schedulePreviewSelection(); if (shotConfig) renderShotWorkspace(); });

const inspectShotWorkspace = () => ({ open: Boolean(shotConfig), mode: shotMode, momentMs: shotMomentMs,
  selectedElementIds: [...shotSelection], revision: authoring.document.revision,
  previewMatchesCompiler: controller.readCompilerCommitState().committedHtml === compiled.html,
  previewNavigationSourceMatchesCompiler: controller.readCompilerCommitState().lastNavigationSourceHtml === compiled.html,
  compilerCommit: controller.readCompilerCommitState(),
  lastPreviewCommitPromotion: { ...lastPreviewCommitPromotion },
  waypointReleasePhase,
  compilerDraft: controller.readCompilerDraftState(),
  projection: shotProjection && { ...shotProjection },
  geometryPump: { running: shotGeometryPumpRunning, activeSamplers: activeShotGeometrySamplers,
    maximumActiveSamplers: maximumActiveShotGeometrySamplers, latestRequestId: latestShotGeometryRequest?.requestId ?? null,
    pendingRequestId: pendingShotGeometryRequest?.requestId ?? null, lastCommittedRequestId: lastCommittedShotGeometryRequestId },
  geometry: shotGeometry.map((sample) => ({ ...sample, contentBounds: { ...sample.contentBounds }, overlayBounds: { ...sample.overlayBounds },
    deltasDevicePixels: { ...sample.deltasDevicePixels } })),
  activeDraft: activeWaypointDraft && { commandBytes: activeWaypointDraft.commandBytes,
    compiledHtml: activeWaypointDraft.compiledHtml, compiledCss: activeWaypointDraft.compiledCss, exportDigest: activeWaypointDraft.exportDigest,
    moveCount: waypointDraftMoveCount, appliedCount: waypointDraftAppliedCount,
    controllerDraft: controller.readCompilerDraftState(),
    operation: structuredClone(activeWaypointDraft.operation) },
});

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
    undoCount: serviceClient ? durableTrajectoryUndoCount : authoring.undo.length,
    redoCount: serviceClient ? durableTrajectoryRedoCount : authoring.redo.length,
    consumedOperationIds: [...authoring.consumedOperationIds],
    selectedTrackId: selectedTrackId as string,
    selectedKeyframeId: selectedKeyframeId as string,
    selectedCreationElementId,
    unavailableSelection,
    unavailableCreation,
    draftConflictRevision,
    draftStaleBaseRevision,
    draftDirty: captureDraft().dirty,
    draftValues: captureDraft().values,
    lastCommitSeq,
    pendingRevision,
    serviceBacked: Boolean(serviceClient),
    activeBranchId,
    immutableRefetchCount,
    lastCommit,
  }),
  dispatch,
  openShotWorkspace,
  inspectShotWorkspace,
  switchBranch,
  disconnectEvents: () => { eventSubscription?.close(); eventSubscriptionGeneration += 1; },
  reconnectEvents: connectEvents,
};

async function dispatch(
  operation: AuthoringOperation,
  focusSelector?: string,
  historyAnchor?: { viewportTop: number; scrollY: number },
  previewPromotion?: PreviewCssCommitPromotion,
): Promise<{ ok: boolean; code?: string }> {
  const beforeCreated = findCreatedTrack(buildTimeline(authoring.document).rows);
  const beforeHasMidpoint = beforeCreated?.keyframes.some((keyframe) => keyframe.offset === 0.5) ?? false;
  let authoritativePreviewAlreadyMounted = false;
  const durableKind = operation.kind === 'motion.track.create' || operation.kind.startsWith('motion.transform-')
    || operation.kind.startsWith('motion.keyframe-group-') || operation.kind === 'motion.settled-hold.set'
    || operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo';
  if (serviceClient && !durableKind) {
    const code = 'SERVICE_OPERATION_UNSUPPORTED';
    status.value = `This durable editor currently supports track creation only. (${code}) Revision ${authoring.document.revision} unchanged.`;
    status.dataset.kind = 'error'; return { ok: false, code };
  }
  let result = dispatchAuthoringOperation(authoring, operation);
  if (serviceClient && durableKind) {
    const command = operation.kind === 'motion.track.create' ? makeTrackCreateCommand({ operationId: operation.operationId,
      documentId: operation.documentId, branchId: activeBranchId, expectedRevision: operation.expectedRevision, elementId: operation.elementId })
      : makeTrajectoryCommand(operation as Parameters<typeof makeTrajectoryCommand>[0], activeBranchId);
    const commandTask = reconciliation.then(async () => {
      let response;
      try { response = await serviceClient.dispatch(command); }
      catch { response = { ok: false, code: 'STORAGE_FAILURE' } as const; }
      if (response.ok) {
        if (operation.kind === 'motion.history.undo') {
          durableTrajectoryUndoCount = Math.max(0, durableTrajectoryUndoCount - 1);
          durableTrajectoryRedoCount += 1;
        } else if (operation.kind === 'motion.history.redo') {
          durableTrajectoryRedoCount = Math.max(0, durableTrajectoryRedoCount - 1);
          durableTrajectoryUndoCount += 1;
        } else if (operation.kind !== 'motion.track.create') {
          durableTrajectoryUndoCount += 1;
          durableTrajectoryRedoCount = 0;
        }
        pendingRevision = response.resultingRevision;
        try {
          await applyImmutable(await serviceClient.revision(response.documentId, response.resultingRevision), false, previewPromotion);
          resolveAcceptedCreationDraft();
        }
        finally { pendingRevision = null; }
        return { response, applied: true, authoritativePreviewAlreadyMounted: true };
      }
      pendingRevision = null;
      if (response.code === 'STALE_REVISION') {
        await applyImmutable(await serviceClient.head(operation.documentId, activeBranchId), true);
      } else if (response.code === 'STORAGE_FAILURE') {
        try {
          const immutable = await serviceClient.head(operation.documentId, activeBranchId);
          const committed = operation.kind === 'motion.track.create' && immutable.document.revision !== operation.expectedRevision
            && buildTimeline(immutable.document).rows.some((row) => row.elementId === operation.elementId && row.property === 'opacity');
          if (committed) {
            await applyImmutable(immutable, false);
            resolveAcceptedCreationDraft();
            return { response, applied: true, authoritativePreviewAlreadyMounted: true };
          }
        } catch { /* The unacknowledged SSE event remains the recovery path. */ }
      }
      return { response, applied: false, authoritativePreviewAlreadyMounted: false };
    });
    reconciliation = commandTask.then(() => undefined, () => undefined);
    const outcome = await commandTask; const response = outcome.response;
    if (!response.ok && !outcome.applied) {
      const code = response.code === 'STALE_REVISION' ? 'AUTHORING_STALE_REVISION' : `SERVICE_${response.code}`;
      status.value = response.code === 'STALE_REVISION'
        ? `${diagnosticMessage(code)} (${code}) Local operation not applied; refreshed to revision ${authoring.document.revision}.`
        : `${diagnosticMessage(code)} (${code}) Revision ${authoring.document.revision} unchanged.`;
      status.dataset.kind = 'error'; return { ok: false, code };
    } else {
      result = { ok: true, state: authoring };
      authoritativePreviewAlreadyMounted = outcome.authoritativePreviewAlreadyMounted;
    }
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
  if (!authoritativePreviewAlreadyMounted) {
    compiled = compileMotionDocument(authoring.document);
    await mountPreview(compiled.html, compiled.css);
  }
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
  if (shotConfig) renderShotWorkspace();
  if (operation.kind === 'motion.track.create') resolveAcceptedCreationDraft();
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

if (serviceClient) connectEvents();

function connectEvents(): void {
  if (!serviceClient) return;
  eventSubscription?.close();
  const generation = ++eventSubscriptionGeneration;
  eventSubscription = serviceClient.events(authoring.document.documentId, lastCommitSeq, (event) => {
    reconciliation = reconciliation.then(() => reconcileCommit(event, generation)).catch((error) => {
      status.value = `Remote refresh failed (${error instanceof Error ? error.message : 'UNKNOWN'}).`;
      status.dataset.kind = 'error';
      if (generation !== eventSubscriptionGeneration) return;
      eventSubscription?.close(); eventSubscriptionGeneration += 1;
      const attempts = reconciliationFailures.get(event.commitSeq) ?? 0;
      reconciliationFailures.set(event.commitSeq, attempts + 1);
      if (attempts === 0) reconnectTimer = setTimeout(connectEvents, 0);
    });
  }, () => {
    if (generation !== eventSubscriptionGeneration) return;
    status.value = 'Live updates disconnected. Reconnecting from the durable cursor…'; status.dataset.kind = 'error';
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectEvents, 100);
  });
}

async function reconcileCommit(event: CommitMetadata, subscriptionGeneration: number): Promise<void> {
  if (!serviceClient || subscriptionGeneration !== eventSubscriptionGeneration || event.commitSeq <= lastCommitSeq) return;
  const acknowledge = () => { lastCommitSeq = event.commitSeq; lastCommit = event; reconciliationFailures.delete(event.commitSeq); };
  const gap = event.commitSeq !== lastCommitSeq + 1;
  if (event.branchId !== activeBranchId) { acknowledge(); return; }
  if (event.kind === 'motion.track.create' && event.revision < authoring.document.revision) { acknowledge(); return; }
  const branchAtStart = branchGeneration;
  const immutable = gap ? await serviceClient.head(event.documentId, event.branchId)
    : await serviceClient.revision(event.documentId, event.revision);
  if (branchAtStart !== branchGeneration || event.branchId !== activeBranchId) return;
  if (!gap && immutable.canonicalDigest !== event.digest) throw new Error('REMOTE_DIGEST_MISMATCH');
  if (gap && immutable.document.revision === event.revision && immutable.canonicalDigest !== event.digest)
    throw new Error('REMOTE_GAP_DIGEST_MISMATCH');
  const applied = immutable.document.revision !== authoring.document.revision;
  if (applied) await applyImmutable(immutable, true);
  acknowledge();
  if (applied || gap) {
    status.value = gap ? `Event gap detected; immutable branch head refetched at revision ${authoring.document.revision}.`
      : `Revision ${authoring.document.revision} refreshed from committed service state.`;
    status.dataset.kind = 'success';
  }
}

async function switchBranch(branchId: string): Promise<void> {
  if (!serviceClient) return; const generation = ++branchGeneration;
  reconciliation = reconciliation.then(async () => {
    const immutable = await serviceClient.head(authoring.document.documentId, branchId);
    if (generation !== branchGeneration) return;
    activeBranchId = branchId; await applyImmutable(immutable, true);
    status.value = `Branch ${branchId} head revision ${authoring.document.revision} loaded.`;
  });
  await reconciliation;
}

async function createBranch(branchId: string): Promise<void> {
  if (!serviceClient) return;
  try {
    const response = await serializeServiceCommand(() => serviceClient.dispatch(makeBranchCreateCommand({ operationId: nextOperationId(),
      documentId: authoring.document.documentId, sourceBranchId: activeBranchId,
      expectedRevision: authoring.document.revision, branchId })));
    if (!response.ok) { status.value = `Branch creation rejected (${response.code}).`; status.dataset.kind = 'error'; return; }
    if (branchSelect && ![...branchSelect.options].some((option) => option.value === branchId)) branchSelect.add(new Option(branchId, branchId));
    if (branchSelect) branchSelect.value = branchId; await switchBranch(branchId); status.dataset.kind = 'success';
  } catch { status.value = 'Branch creation rejected (VALIDATION).'; status.dataset.kind = 'error'; }
}

async function revokeClaim(claimId: string, leaseVersion: number): Promise<void> {
  if (!serviceClient) return;
  try {
    const documentRevision = await serviceClient.documentRevision(authoring.document.documentId);
    const response = await serializeServiceCommand(() => serviceClient.dispatch(makeClaimControlCommand({ kind: 'motion.claim.revoke', operationId: nextOperationId(),
      documentId: authoring.document.documentId, branchId: activeBranchId, expectedRevision: documentRevision.revision,
      claimId, leaseVersion })));
    status.value = response.ok ? `Claim ${response.claimId} revoked at lease version ${response.leaseVersion}.`
      : `Claim revocation rejected (${response.code}).`; status.dataset.kind = response.ok ? 'success' : 'error';
  } catch { status.value = 'Claim revocation rejected (VALIDATION).'; status.dataset.kind = 'error'; }
}

async function serializeServiceCommand<T>(command: () => Promise<T>): Promise<T> {
  const task = reconciliation.then(command); reconciliation = task.then(() => undefined, () => undefined); return task;
}

function clearKeyframeSelection(): void {
  selectedTrackId = null;
  selectedKeyframeId = null;
  hasExplicitKeyframeSelection = false;
}

type ImmutableHead = Awaited<ReturnType<MotionServiceClient['head']>>;
async function applyImmutable(immutable: ImmutableHead, remote: boolean, previewPromotion?: PreviewCssCommitPromotion): Promise<void> {
  const draft = captureDraft();
  authoring = createAuthoringState(immutable.document); const nextCompiled = compileMotionDocument(authoring.document);
  let promoted = false;
  if (previewPromotion) {
    try {
      await controller.promoteCompilerCssCommit({ ...previewPromotion, newCommittedHtml: nextCompiled.html, newCompilerCss: nextCompiled.css });
      promoted = true; lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
        promoted: true, fallbackCode: null };
    } catch (error) {
      lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true, promoted: false,
        fallbackCode: error instanceof Error ? error.message : 'PREVIEW_CSS_COMMIT_PROMOTION_INVALID' };
    }
  } else {
    lastPreviewCommitPromotion = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: false,
      promoted: false, fallbackCode: null };
  }
  compiled = nextCompiled; immutableRefetchCount += 1;
  if (!promoted) await mountPreview(compiled.html, compiled.css);
  renderProjection();
  if (shotConfig) renderShotWorkspace();
  if (draft.dirty) {
    restoreDraft(draft);
    if (remote) { draftConflictRevision = authoring.document.revision;
      draftConflict.hidden = false; draftConflict.dataset.revision = String(draftConflictRevision); }
  } else {
    draftStaleBaseRevision = null;
  }
}

type DraftSnapshot = { dirty: boolean; values: Record<string, string>; dirtyFields: Record<string, boolean>;
  creationElementId: StructuralAuthoringElementId | null; creationDirty: boolean; staleBaseRevision: number | null };
function captureDraft(): DraftSnapshot {
  const values: Record<string, string> = {}; const dirtyFields: Record<string, boolean> = {};
  for (const selector of ['[data-duration]', '[data-delay]', '[data-easing]', '[data-value]', '[data-time]',
    '[data-new-branch]', '[data-claim-id]', '[data-lease-version]']) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (!control) continue;
    values[selector] = control.value;
    dirtyFields[selector] = selector === '[data-duration]' || selector === '[data-delay]' || selector === '[data-easing]'
      ? control.closest<HTMLElement>('.timing-control')?.dataset.draft === 'true' : control.dataset.draft === 'true';
  }
  const dirty = Object.values(dirtyFields).some(Boolean) || creationDraftDirty;
  return { dirty, values, dirtyFields, creationElementId: selectedCreationElementId, creationDirty: creationDraftDirty,
    staleBaseRevision: dirtyStaleBase(dirty) };
}
function restoreDraft(draft: DraftSnapshot): void {
  for (const [selector, value] of Object.entries(draft.values)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (control) control.value = value;
  }
  selectedCreationElementId = draft.creationElementId;
  creationDraftDirty = draft.creationDirty; draftStaleBaseRevision = draft.staleBaseRevision;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]'))
    radio.checked = radio.value === selectedCreationElementId;
  for (const [selector, dirty] of Object.entries(draft.dirtyFields)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (!control) continue;
    if (selector === '[data-duration]' || selector === '[data-delay]' || selector === '[data-easing]') {
      control.closest<HTMLElement>('.timing-control')!.dataset.draft = String(dirty);
      required<HTMLElement>('em', control.closest('.timing-control')!).hidden = !dirty;
    } else control.dataset.draft = String(dirty);
  }
}
function resolveDraftConflict(keep: boolean): void {
  if (!keep) {
    selectedCreationElementId = null; creationDraftDirty = false; draftStaleBaseRevision = null;
    valueInput.value = ''; timeInput.value = ''; valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) radio.checked = false;
    for (const control of document.querySelectorAll<HTMLInputElement>('[data-new-branch], [data-claim-id], [data-lease-version]')) {
      control.value = control.defaultValue; control.dataset.draft = 'false';
    }
    renderProjection();
  }
  draftConflictRevision = null; draftConflict.hidden = true;
  status.value = keep ? `Local draft kept against revision ${authoring.document.revision}; apply it explicitly when ready.`
    : `Local draft discarded; revision ${authoring.document.revision} values restored.`;
  status.dataset.kind = 'success';
}

function dirtyStaleBase(dirty: boolean): number | null {
  return dirty ? draftStaleBaseRevision ?? authoring.document.revision : null;
}

function resolveAcceptedCreationDraft(): void {
  creationDraftDirty = false;
  if (captureDraft().dirty) return;
  draftStaleBaseRevision = null;
  draftConflictRevision = null;
  draftConflict.hidden = true;
  delete draftConflict.dataset.revision;
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
  return `editor:${operationClientId}:${operationSequence}`;
}

function renderProjection(): void {
  const timeline = buildTimeline(authoring.document);
  const timelineElement = required<HTMLElement>('[data-timeline]');
  timelineElement.dataset.durationMs = String(timeline.durationMs);
  scrubber.max = String(shotConfig ? Math.min(timeline.durationMs, 2101) : timeline.durationMs);
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
  for (const [button, unavailable] of [[undoButton, serviceClient ? durableTrajectoryUndoCount === 0 : authoring.undo.length === 0],
    [redoButton, serviceClient ? durableTrajectoryRedoCount === 0 : authoring.redo.length === 0]] as const) {
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
    radio.disabled = locked || !eligibility.available;
    required(`[data-choice-reason="${choice.elementId}"]`).textContent = eligibility.available
      ? 'Available' : eligibilityReason(eligibility.reason);
  }
  const selectedEligibility = selectedCreationElementId
    ? projectTrackCreationEligibility(authoring.document, selectedCreationElementId, 'opacity') : null;
  unavailableCreation = Boolean(selectedCreationElementId && !selectedEligibility?.available);
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
  unavailableSelection = Boolean(hasExplicitKeyframeSelection && (!row || !keyframe));
  const locked = (authoring.document.holds ?? []).length > 0;
  valueInput.disabled = locked || !hasExplicitKeyframeSelection;
  timeInput.disabled = locked || !hasExplicitKeyframeSelection;
  valueButton.disabled = locked || !hasExplicitKeyframeSelection;
  timeButton.disabled = locked || !hasExplicitKeyframeSelection;
  if (unavailableSelection) {
    disableUnavailableMutationControls();
    required('[data-selection]').innerHTML = `<div class="selection-summary unavailable"><strong>Selected canonical target unavailable</strong><span>Track ${selectedTrackId} · keyframe ${selectedKeyframeId}</span></div>`;
    previewSelectionLabel.textContent = 'Selection unavailable'; previewSelection.hidden = true; return;
  }
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
  valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
  valueInput.setAttribute('aria-invalid', 'false');
  timeInput.setAttribute('aria-invalid', 'false');
  schedulePreviewSelection();
}

function disableUnavailableMutationControls(): void {
  for (const control of [createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput,
    setDurationButton, setDelayButton, setEasingButton, valueInput, timeInput, valueButton, timeButton, insertHoldButton])
    control.disabled = true;
}

function findEditableTrack(): TimelineRow | null {
  const timeline = buildTimeline(authoring.document);
  const created = findCreatedTrack(timeline.rows);
  if (created) return created;
  const editable = timeline.rows.filter((row) => row.property === 'opacity'
    && timeline.rows.filter((candidate) => candidate.ruleId === row.ruleId && candidate.property === row.property).length === 1);
  return editable.length === 1 ? editable[0]! : null;
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
  stopPlaybackFeedback();
  controller.scrub(timeMs); scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`;
  updatePreviewPlaybackState();
  republishShotGeometry();
  schedulePreviewSelection();
}

function stopPlaybackFeedback(): void {
  if (playbackFeedbackFrame !== null) cancelAnimationFrame(playbackFeedbackFrame);
  playbackFeedbackFrame = null;
}

function syncPlaybackFeedback(): void {
  const state = controller.readState();
  const nativeTime = state.currentTimes.find((time): time is number => typeof time === 'number');
  if (nativeTime === undefined) return;
  const shotEndMs = shotConfig?.settledMs;
  if (shotEndMs !== undefined && (nativeTime > shotEndMs
    || (nativeTime === shotEndMs && state.playStates.some((playState) => playState === 'running')))) {
    controller.pause();
    controller.scrub(shotEndMs);
    scrubber.value = String(shotEndMs); playhead.value = `${shotEndMs} ms`;
    updatePreviewPlaybackState(shotEndMs, true);
    schedulePreviewSelection();
    return;
  }
  const visibleTime = Math.max(0, Math.min(Number(scrubber.max), Math.round(nativeTime)));
  scrubber.value = String(visibleTime); playhead.value = `${visibleTime} ms`;
  updatePreviewPlaybackState(nativeTime, state.playStates.every((playState) => playState !== 'running'));
  schedulePreviewSelection();
}

function startPlaybackFeedback(): void {
  stopPlaybackFeedback();
  const tick = () => {
    syncPlaybackFeedback();
    if (controller.readState().playStates.some((playState) => playState === 'running')) playbackFeedbackFrame = requestAnimationFrame(tick);
    else playbackFeedbackFrame = null;
  };
  playbackFeedbackFrame = requestAnimationFrame(tick);
}

function alignShotPreviewToMoment(timeMs: number): boolean {
  if (!Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > authoring.document.durationMs) {
    shotStatus.value = `PREVIEW_TIME_INVALID · revision ${authoring.document.revision} unchanged.`; return false;
  }
  stopPlaybackFeedback(); controller.scrub(timeMs);
  const state = controller.readState();
  if (state.playheadMs !== timeMs || state.currentTimes.length === 0 || state.currentTimes.some((currentTime) => currentTime !== timeMs)
    || state.playStates.some((playState) => playState !== 'paused')) {
    shotStatus.value = `PREVIEW_MOMENT_ALIGNMENT_INVALID · revision ${authoring.document.revision} unchanged.`; return false;
  }
  scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`; updatePreviewPlaybackState(); schedulePreviewSelection(); return true;
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
  const editable = row.trackId === findEditableTrack()?.trackId;
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

async function mountPreview(compiledHtml: string, compilerCss: string): Promise<void> {
  if (shotGeometryPumpRunning) await shotGeometryPumpCompletion;
  await controller.mount(compiledHtml, compilerCss);
  mountedPreviewGeneration += 1;
  const requestedPlayheadMs = Number(scrubber.value);
  const mountedState = controller.readState();
  if (Number.isFinite(requestedPlayheadMs) && requestedPlayheadMs >= 0
    && (mountedState.playheadMs !== requestedPlayheadMs || mountedState.currentTimes.some((time) => time !== requestedPlayheadMs))) {
    controller.scrub(requestedPlayheadMs); playhead.value = `${requestedPlayheadMs} ms`;
  }
  configurePreviewCanvas();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (shotConfig) renderShotWorkspace();
}

function configurePreviewCanvas(): void {
  const source = controller.sourceSize(); const availableWidth = previewStage.clientWidth;
  if (!Number.isSafeInteger(source.widthCssPixels) || source.widthCssPixels <= 0
    || !Number.isSafeInteger(source.heightCssPixels) || source.heightCssPixels <= 0) throw new Error('PREVIEW_SOURCE_SIZE_INVALID');
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) throw new Error('PREVIEW_PROJECTION_INVALID');
  const runway = shotConfig ? 72 : 0;
  const previewPanel = required<HTMLElement>('.preview-panel');
  const panelTop = previewPanel.getBoundingClientRect().top;
  const chromeHeight = required<HTMLElement>('.preview-title').offsetHeight + required<HTMLElement>('.transport').offsetHeight;
  const visiblePanelTop = getComputedStyle(previewPanel).position === 'static' || panelTop >= window.innerHeight ? 0 : Math.max(0, panelTop);
  const availableHeight = Math.max(240, window.innerHeight - visiblePanelTop - chromeHeight - 48);
  const scale = Math.min((availableWidth - runway * 2) / source.widthCssPixels,
    (availableHeight - runway * 2) / source.heightCssPixels);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('PREVIEW_PROJECTION_INVALID');
  previewCanvas.style.width = `${source.widthCssPixels}px`; previewCanvas.style.height = `${source.heightCssPixels}px`;
  previewCanvas.style.left = `${runway}px`; previewCanvas.style.top = `${runway}px`;
  previewCanvas.style.transform = `scale(${scale})`; previewStage.style.height = `${source.heightCssPixels * scale + runway * 2}px`;
  previewStage.dataset.runwayCssPixels = String(runway);
  iframe.style.width = `${source.widthCssPixels}px`; iframe.style.height = `${source.heightCssPixels}px`;
}

function readShotProjection(): PreviewOverlayProjection | null {
  const source = controller.sourceSize();
  const result = createPreviewOverlayProjection({ sourceWidthCssPixels: source.widthCssPixels,
    sourceHeightCssPixels: source.heightCssPixels, iframeRect: rectValue(iframe.getBoundingClientRect()),
    overlayRect: rectValue(shotOverlay.getBoundingClientRect()), devicePixelRatio: window.devicePixelRatio });
  if (!result.ok) { shotStatus.value = `${result.code} · revision ${authoring.document.revision} unchanged.`; return null; }
  return result.projection;
}

function rectValue(rect: DOMRect): ProjectionRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function updatePreviewSelection(): void {
  syncPreviewObjectTargets();
  const selectedRow = selectedTrackId
    ? buildTimeline(authoring.document).rows.find((row) => row.trackId === selectedTrackId) : undefined;
  const targetElementId = shotConfig && shotPrimaryElementId ? shotPrimaryElementId : selectedCreationElementId ?? selectedRow?.elementId;
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
  previewSelection.style.left = `${targetRect.left}px`;
  previewSelection.style.top = `${targetRect.top}px`;
  previewSelection.style.width = `${targetRect.width}px`;
  previewSelection.style.height = `${targetRect.height}px`;
  if (shotConfig && shotPrimaryElementId) {
    previewSelection.querySelector('span')!.textContent = `Object ${shotConfig.targetElementIds.indexOf(shotPrimaryElementId) + 1}`;
  }
  previewSelection.hidden = false;
}

function syncPreviewObjectTargets(): void {
  if (!shotConfig) {
    previewObjectOverlay.replaceChildren();
    previewObjectOverlay.hidden = true;
    return;
  }
  previewObjectOverlay.hidden = false;
  const existing = new Map([...previewObjectOverlay.querySelectorAll<HTMLButtonElement>('[data-preview-control-key]')]
    .map((button) => [button.dataset.previewControlKey!, button]));
  const desired = new Set<string>();
  const source = controller.sourceSize();
  const displayScale = iframe.getBoundingClientRect().width / source.widthCssPixels;
  const targetSize = Number.isFinite(displayScale) && displayScale > 0 ? 44 / displayScale : 44;
  for (const [index, elementId] of shotConfig.targetElementIds.entries()) {
    const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`);
    const bodyKey = `${elementId}:body`; desired.add(bodyKey);
    let button = existing.get(bodyKey);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'preview-object-target';
      button.dataset.previewControlKey = bodyKey;
      button.dataset.previewObjectId = elementId;
      button.addEventListener('click', () => {
        if (button!.dataset.dragged === 'true') return;
        selectShotPrimary(elementId);
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (shotPrimaryElementId !== elementId) selectShotPrimary(elementId);
        beginDirectPoseGesture(event, 'move');
      });
      button.addEventListener('keydown', (event) => void handleDirectPoseKeyboard(event, 'body'));
      previewObjectOverlay.append(button);
    }
    button.setAttribute('aria-label', `Object ${index + 1}; drag to move`);
    button.setAttribute('aria-pressed', String(elementId === shotPrimaryElementId));
    button.dataset.objectLabel = `Object ${index + 1}`;
    button.hidden = !target;
    if (target) {
      const rect = target.getBoundingClientRect();
      const bodyWidth = Math.max(rect.width, targetSize); const bodyHeight = Math.max(rect.height, targetSize);
      button.style.left = `${rect.left + rect.width / 2 - bodyWidth / 2}px`;
      button.style.top = `${rect.top + rect.height / 2 - bodyHeight / 2}px`;
      button.style.width = `${bodyWidth}px`; button.style.height = `${bodyHeight}px`;
      for (const kind of ['scale', 'rotate'] as const) {
        const key = `${elementId}:${kind}`; desired.add(key); let handle = existing.get(key);
        if (!handle) {
          handle = document.createElement('button'); handle.type = 'button';
          handle.className = `preview-transform-handle ${kind}-handle`; handle.dataset.previewControlKey = key;
          handle.dataset.transformElementId = elementId; handle.dataset.transformHandle = kind;
          handle.setAttribute('role', 'slider'); handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return; if (shotPrimaryElementId !== elementId) selectShotPrimary(elementId);
            beginDirectPoseGesture(event, kind);
          });
          handle.addEventListener('keydown', (event) => void handleDirectPoseKeyboard(event, kind));
          previewObjectOverlay.append(handle);
        }
        const selected = elementId === shotPrimaryElementId; handle.hidden = !selected;
        handle.style.width = `${targetSize}px`; handle.style.height = `${targetSize}px`;
        handle.style.left = `${rect.right + targetSize * .1}px`;
        handle.style.top = `${kind === 'scale' ? rect.bottom + targetSize * .1 : rect.top - targetSize * 1.1}px`;
        const trajectory = projectTransformTrajectory(authoring.document, elementId);
        const pose = trajectory.eligible ? trajectory.waypoints.find((point) => point.timeMs === shotMomentMs)?.pose : undefined;
        const value = kind === 'scale' ? (pose?.scalePpm ?? 1_000_000) / 1_000_000 : (pose?.rotateMicrodegrees ?? 0) / 1_000_000;
        handle.setAttribute('aria-label', `${kind === 'scale' ? 'Uniform scale' : 'Rotation'} for Object ${index + 1}`);
        handle.setAttribute('aria-valuemin', kind === 'scale' ? '0.25' : '-180'); handle.setAttribute('aria-valuemax', kind === 'scale' ? '3' : '180');
        handle.setAttribute('aria-valuenow', String(value)); handle.setAttribute('aria-valuetext', kind === 'scale' ? `${value} uniform scale` : `${value} degrees`);
      }
    }
  }
  for (const [key, button] of existing) if (!desired.has(key)) button.remove();
}

function openShotWorkspace(config: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] }): { ok: boolean; code?: string } {
  const projection = projectShotWorkspace(authoring.document, config);
  if (!projection.eligible) { const code = projection.code ?? 'SHOT_WORKSPACE_UNAVAILABLE'; shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`; return { ok: false, code }; }
  const source = controller.sourceSize();
  if (!Number.isSafeInteger(source.widthCssPixels) || source.widthCssPixels <= 0
    || !Number.isSafeInteger(source.heightCssPixels) || source.heightCssPixels <= 0 || !readShotProjection()) {
    const code = 'PREVIEW_SOURCE_SIZE_INVALID'; shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`;
    return { ok: false, code };
  }
  shotConfig = { ...config, targetElementIds: [...config.targetElementIds].sort() };
  shotWorkspace.removeAttribute('aria-disabled'); shotWorkspace.dataset.editable = 'true'; shotRecovery.hidden = true; shotStatus.setAttribute('role', 'status');
  for (const control of shotWorkspace.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) control.disabled = false;
  shotPrimaryElementId = shotConfig.targetElementIds[0]!;
  shotSelection = [shotPrimaryElementId]; shotMomentMs = config.landedMs; shotWorkspace.hidden = false;
  activateShotLayout(); configurePreviewCanvas();
  scrubber.max = String(Math.min(authoring.document.durationMs, 2101));
  if (!alignShotPreviewToMoment(shotMomentMs)) return { ok: false, code: 'PREVIEW_MOMENT_ALIGNMENT_INVALID' };
  renderShotWorkspace(); configurePreviewCanvas(); renderShotWorkspace(); return { ok: true };
}

function activateShotLayout(): void {
  const shell = required<HTMLElement>('.editor-shell');
  const layout = required<HTMLElement>('.primary-layout');
  const workflow = required<HTMLElement>('.workflow');
  layout.insertBefore(shotWorkspace, workflow);
  required<HTMLElement>('[data-shot-history-slot]').append(required<HTMLElement>('.workflow-footer'));
  shell.classList.add('shot-active');
  required<HTMLElement>('.topbar h1').textContent = 'Shape the shot against the native preview';
  required<HTMLElement>('.purpose').textContent = 'Choose the primary object, set the edit scope, and adjust canonical moments beside the compiled CSS.';
}

function initializeSeedWorkspace(): void {
  const metadata = payload.shotWorkspace;
  if (!metadata) return;
  const structuralElementIds = authoring.document.elements.map((element) => element.id).sort();
  const targets = [...metadata.targetElementIds];
  const bindingValid = metadata.schemaVersion === 'motion.editor-shot-workspace.v1'
    && metadata.documentId === authoring.document.documentId
    && metadata.startMs === 0 && metadata.landedMs === 700 && metadata.settledMs === 2100
    && targets.length === 2
    && targets.every((elementId, index) => elementId === structuralElementIds[index]);
  if (bindingValid) {
    const opened = openShotWorkspace({ startMs: metadata.startMs, landedMs: metadata.landedMs,
      settledMs: metadata.settledMs, targetElementIds: targets });
    if (opened.ok) return;
    showSeedWorkspaceFailure(opened.code ?? 'SHOT_WORKSPACE_UNAVAILABLE');
    return;
  }
  showSeedWorkspaceFailure('SHOT_WORKSPACE_METADATA_MISMATCH');
}

function showSeedWorkspaceFailure(code: string): void {
  shotConfig = null;
  shotSelection = [];
  shotPrimaryElementId = null;
  shotWorkspace.hidden = false;
  shotWorkspace.removeAttribute('aria-disabled'); shotWorkspace.dataset.editable = 'false';
  for (const control of shotWorkspace.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) {
    control.disabled = true;
  }
  shotRecovery.hidden = false;
  required<HTMLElement>('[data-shot-recovery-copy]').textContent = `${code}. The committed document was not changed. Restore a compatible Shot 1 revision or source, then retry; you can still inspect every track now.`;
  required<HTMLButtonElement>('[data-shot-retry]').disabled = false;
  required<HTMLButtonElement>('[data-shot-inspect]').disabled = false;
  shotStatus.setAttribute('role', 'alert');
  shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged. Manual Shot editing is unavailable.`;
}

function canonicalShotInventory() {
  if (!shotConfig) return null;
  const inventories = shotConfig.targetElementIds.map((elementId) => {
    const trajectory = projectTransformTrajectory(authoring.document, elementId);
    if (!trajectory.eligible) return null;
    const waypoints = trajectory.waypoints.filter((waypoint) => waypoint.timeMs >= shotConfig!.startMs && waypoint.timeMs <= shotConfig!.settledMs)
      .sort((left, right) => left.timeMs - right.timeMs || left.keyframeId.localeCompare(right.keyframeId));
    if (waypoints.some((waypoint) => !Number.isSafeInteger(waypoint.timeMs) || !waypoint.keyframeId)
      || new Set(waypoints.map((waypoint) => waypoint.timeMs)).size !== waypoints.length) return null;
    return { elementId, waypoints };
  });
  const validInventories = inventories.filter((inventory): inventory is NonNullable<typeof inventory> => inventory !== null);
  if (validInventories.length !== shotConfig.targetElementIds.length) return null;
  return validInventories;
}

function isSharedShotMoment(inventories: NonNullable<ReturnType<typeof canonicalShotInventory>>, elementIds: string[], timeMs: number): boolean {
  return elementIds.every((elementId) => inventories.find((inventory) => inventory.elementId === elementId)
    ?.waypoints.some((waypoint) => waypoint.timeMs === timeMs) === true);
}

function selectShotPrimary(elementId: string): void {
  if (!shotConfig || !shotConfig.targetElementIds.includes(elementId)) return;
  shotPrimaryElementId = elementId;
  shotSelection = required<HTMLInputElement>('[data-move-together]').checked ? [...shotConfig.targetElementIds] : [elementId];
  renderShotWorkspace(); schedulePreviewSelection();
}

function selectShotMode(nextMode: 'pose' | 'path'): void {
  if (nextMode === 'path' && !alignShotPreviewToMoment(shotMomentMs)) return;
  shotMode = nextMode;
  shotWorkspace.querySelectorAll<HTMLButtonElement>('[data-shot-mode]').forEach((item) =>
    item.setAttribute('aria-pressed', String(nextMode === 'path')));
  renderShotWorkspace();
}

function selectShotMoment(timeMs: number): void {
  if (!alignShotPreviewToMoment(timeMs)) return;
  shotMomentMs = timeMs; renderShotWorkspace();
}

function shotMomentLabel(timeMs: number): string {
  return timeMs === shotConfig?.startMs ? 'Start' : timeMs === shotConfig?.settledMs ? 'Settled' : `${timeMs} ms`;
}

function updatePreviewPlaybackState(timeMs?: number, paused = false): void {
  const editing = shotMomentLabel(shotMomentMs);
  previewShotState.value = timeMs === undefined ? `Editing ${editing}`
    : `${paused ? 'Paused' : 'Previewing'} ${Math.round(timeMs)} ms · ${editing}`;
}

function syncPreviewShotToolbar(requestedTimes: number[]): void {
  previewShotToolbar.hidden = !shotConfig;
  if (!shotConfig || !shotPrimaryElementId) return;
  const primaryIndex = shotConfig.targetElementIds.indexOf(shotPrimaryElementId);
  previewShotObject.textContent = `Object ${primaryIndex + 1}`;
  if (playbackFeedbackFrame === null) updatePreviewPlaybackState();
  const descriptors = [
    { key: 'mode:path', label: 'Path', ariaLabel: 'Show path overlay', pressed: shotMode === 'path',
      action: () => selectShotMode(shotMode === 'path' ? 'pose' : 'path') },
    ...shotConfig.targetElementIds.map((elementId, index) => ({ key: `primary:${elementId}`, label: `Object ${index + 1}`,
      ariaLabel: `Edit Object ${index + 1} from preview`, pressed: elementId === shotPrimaryElementId,
      action: () => selectShotPrimary(elementId) })),
    ...requestedTimes.map((timeMs) => ({ key: `moment:${timeMs}`, label: shotMomentLabel(timeMs),
      ariaLabel: `Edit ${shotMomentLabel(timeMs)} waypoint from preview`, pressed: timeMs === shotMomentMs,
      action: () => selectShotMoment(timeMs) })),
    { key: 'group', label: 'Move together', ariaLabel: 'Move both objects together from preview',
      pressed: required<HTMLInputElement>('[data-move-together]').checked,
      action: () => required<HTMLInputElement>('[data-move-together]').click() },
  ];
  const existing = new Map([...previewShotActions.querySelectorAll<HTMLButtonElement>('button[data-preview-shot-key]')]
    .map((button) => [button.dataset.previewShotKey!, button]));
  const desired = new Set(descriptors.map((descriptor) => descriptor.key));
  for (const [index, descriptor] of descriptors.entries()) {
    let button = existing.get(descriptor.key);
    if (!button) { button = document.createElement('button'); button.type = 'button'; button.dataset.previewShotKey = descriptor.key;
      button.addEventListener('click', descriptor.action); }
    button.textContent = descriptor.label; button.setAttribute('aria-label', descriptor.ariaLabel);
    button.setAttribute('aria-pressed', String(descriptor.pressed));
    const current = previewShotActions.querySelectorAll<HTMLButtonElement>('button[data-preview-shot-key]').item(index);
    if (current !== button) previewShotActions.insertBefore(button, current);
  }
  for (const [key, button] of existing) if (!desired.has(key)) button.remove();
}

function renderShotWorkspace(): void {
  if (!shotConfig) return;
  const momentBeforeReconciliation = shotMomentMs;
  shotTargets.querySelectorAll('label').forEach((item) => item.remove());
  for (const [index, elementId] of shotConfig.targetElementIds.entries()) {
    const label = document.createElement('label'); label.className = 'shot-object';
    const primary = document.createElement('input'); primary.type = 'radio'; primary.name = 'shot-primary'; primary.value = elementId;
    primary.checked = elementId === shotPrimaryElementId; primary.setAttribute('aria-label', `Primary Object ${index + 1}`);
    primary.addEventListener('change', () => { if (primary.checked) selectShotPrimary(elementId); });
    const copy = document.createElement('span'); copy.innerHTML = `<strong>Object ${index + 1}</strong><small>Primary</small>`;
    label.append(primary, copy); shotTargets.append(label);
  }
  const primary = shotPrimaryElementId ?? shotSelection[0]!; const inventories = canonicalShotInventory();
  const primaryInventory = inventories?.find((inventory) => inventory.elementId === primary);
  if (!inventories || !primaryInventory) { shotGeometry = []; shotProjection = null; shotOverlay.replaceChildren();
    shotOverlay.setAttribute('aria-busy', 'false'); shotStatus.value = 'TRAJECTORY_INVENTORY_DIVERGED'; return; }
  const moveTogether = required<HTMLInputElement>('[data-move-together]');
  const primaryTimes = primaryInventory.waypoints.map((waypoint) => waypoint.timeMs);
  const sharedTimes = primaryTimes.filter((timeMs) => isSharedShotMoment(inventories, shotConfig!.targetElementIds, timeMs));
  if (moveTogether.checked && !sharedTimes.includes(shotMomentMs)) {
    if (sharedTimes.length > 0) shotMomentMs = [...sharedTimes]
      .sort((left, right) => Math.abs(left - shotMomentMs) - Math.abs(right - shotMomentMs) || left - right)[0]!;
    else { moveTogether.checked = false; shotSelection = [primary]; }
  }
  if (moveTogether.checked) shotSelection = [...shotConfig.targetElementIds];
  const requestedTimes = moveTogether.checked ? sharedTimes : primaryTimes;
  if (!requestedTimes.includes(shotMomentMs)) shotMomentMs = [...requestedTimes]
    .sort((left, right) => Math.abs(left - shotMomentMs) - Math.abs(right - shotMomentMs) || left - right)[0]!;
  if (shotMode === 'path' && shotMomentMs !== momentBeforeReconciliation && !alignShotPreviewToMoment(shotMomentMs)) return;
  moveTogether.disabled = !moveTogether.checked && !sharedTimes.includes(shotMomentMs);
  const displayedWaypoints = primaryInventory.waypoints.filter((waypoint) => requestedTimes.includes(waypoint.timeMs));
  const displayedPaths = inventories.map((inventory, objectIndex) => ({ elementId: inventory.elementId, objectIndex,
    waypoints: inventory.waypoints.map(({ keyframeId, timeMs }) => ({ keyframeId, timeMs })) }));
  const geometryTimes = [...new Set(displayedPaths.flatMap((path) => path.waypoints.map((waypoint) => waypoint.timeMs)))].sort((a, b) => a - b);
  shotMoments.querySelectorAll('label').forEach((item) => item.remove());
  for (const timeMs of requestedTimes) {
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'radio'; input.name = 'shot-moment';
    input.value = String(timeMs); input.checked = timeMs === shotMomentMs;
    input.addEventListener('change', () => { if (input.checked) selectShotMoment(timeMs); });
    label.append(input, document.createTextNode(timeMs === 0 ? 'Start' : timeMs === 2100 ? 'Settled' : `${timeMs} ms`)); shotMoments.append(label);
  }
  const projection = readShotProjection();
  if (!projection) { shotGeometry = []; committedShotGeometryKey = null; shotOverlay.replaceChildren();
    shotOverlay.setAttribute('aria-busy', 'false'); return; }
  const geometryKey = sha256Hex(canonicalJson({ mountedPreviewGeneration, compilerDigest: compiled.exportDigest, primaryElementId: primary,
    waypoints: displayedWaypoints.map(({ keyframeId, timeMs }) => ({ keyframeId, timeMs })), paths: displayedPaths, requestedTimes: geometryTimes,
    projection: { sourceWidthCssPixels: projection.sourceWidthCssPixels, sourceHeightCssPixels: projection.sourceHeightCssPixels,
      displayLeft: projection.displayLeft, displayTop: projection.displayTop, displayWidth: projection.displayWidth,
      displayHeight: projection.displayHeight, scaleX: projection.scaleX, scaleY: projection.scaleY,
      devicePixelRatio: projection.devicePixelRatio } }));
  const latestKey = latestShotGeometryRequest?.geometryKey;
  if (geometryKey !== latestKey) {
    const geometryGeneration = ++shotGeometryGeneration;
    publishShotGeometry({ workspaceGeneration: geometryGeneration, primaryElementId: primary, geometryKey,
      waypoints: displayedWaypoints, paths: displayedPaths, requestedTimes: geometryTimes });
  } else if (committedShotGeometryKey !== geometryKey && !pendingShotGeometryRequest && !shotGeometryPumpRunning) {
    publishShotGeometry({ workspaceGeneration: shotGeometryGeneration, primaryElementId: primary, geometryKey,
      waypoints: displayedWaypoints, paths: displayedPaths, requestedTimes: geometryTimes });
  }
  const selected = primaryInventory.waypoints.find((point) => point.timeMs === shotMomentMs);
  const primaryLabel = `Object ${shotConfig.targetElementIds.indexOf(primary) + 1}`;
  const momentLabel = shotMomentLabel(shotMomentMs);
  shotWorkspace.dataset.mode = shotMode;
  syncPreviewShotToolbar(requestedTimes);
  previewSelectionLabel.textContent = `${primaryLabel} selected`;
  shotGuidance.textContent = `Editing ${primaryLabel} at ${momentLabel}. Drag the object to move it, the square handle to scale, or the round handle to rotate.${moveTogether.checked ? ' Object movement translates both objects together.' : ''}${shotMode === 'path' ? ' Path waypoints are visible and draggable.' : ''}`;
  const controls = shotPoseForm.elements as unknown as Record<string, HTMLInputElement>;
  for (const control of shotPoseForm.querySelectorAll<HTMLInputElement>('input')) control.disabled = !selected;
  if (selected) { controls.x!.value = String(selected.pose.translateXMicrounits / 1_000_000); controls.y!.value = String(selected.pose.translateYMicrounits / 1_000_000);
    controls.scale!.value = String(selected.pose.scalePpm / 1_000_000); controls.rotate!.value = String(selected.pose.rotateMicrodegrees / 1_000_000); }
  syncShotTimingControls(inventories);
  shotOverlay.dataset.mode = shotMode;
  previewObjectOverlay.dataset.mode = shotMode;
  shotOverlay.toggleAttribute('inert', shotMode !== 'path');
  syncReferencePathSelection();
  for (const handle of shotOverlay.querySelectorAll<HTMLElement>('[data-keyframe-id][data-time-ms]')) {
    handle.setAttribute('aria-pressed', String(Number(handle.dataset.timeMs) === shotMomentMs));
  }
  const currentGeometry = committedShotGeometryKey === geometryKey;
  shotOverlay.setAttribute('aria-busy', String(!currentGeometry));
  shotStatus.value = currentGeometry
    ? `Revision ${authoring.document.revision} · ${shotSelection.length} selected · ${shotMomentMs} ms editable against native bounds.`
    : `Revision ${authoring.document.revision} · measuring compiler-native geometry.`;
  schedulePreviewSelection();
}

function syncShotTimingControls(inventories: NonNullable<ReturnType<typeof canonicalShotInventory>>): void {
  if (!shotConfig) return;
  const sharedTimes = inventories[0]!.waypoints.map((waypoint) => waypoint.timeMs)
    .filter((timeMs) => inventories.every((inventory) => inventory.waypoints.some((waypoint) => waypoint.timeMs === timeMs)));
  const landing = sharedTimes.find((timeMs) => timeMs > shotConfig!.startMs && timeMs < shotConfig!.settledMs) ?? shotConfig.landedMs;
  const settled = sharedTimes.length > 3 ? sharedTimes.at(-2)! : shotConfig.settledMs;
  shotConfig.landedMs = landing;
  required<HTMLInputElement>('[data-shot-landing]').value = String(landing);
  required<HTMLInputElement>('[data-shot-settled]').value = String(settled);
  const selected = projectTrajectorySelection(authoring.document, shotConfig.targetElementIds, landing);
  if (!selected.eligible) return;
  const timings = effectiveShotTimings(selected.targets);
  if (timings && timings.every((timing) => canonicalJson(timing) === canonicalJson(timings[0]))) {
    const timing = timings[0]!;
    if (timing.kind === 'keyword') required<HTMLSelectElement>('[data-shot-easing]').value = timing.value;
  }
}

function publishShotGeometry(request: Omit<ShotGeometryRequest, 'requestId'>): void {
  const published = { ...request, requestId: ++shotGeometryRequestId,
    waypoints: request.waypoints.map((waypoint) => ({ ...waypoint })),
    paths: request.paths.map((path) => ({ ...path, waypoints: path.waypoints.map((waypoint) => ({ ...waypoint })) })),
    requestedTimes: [...request.requestedTimes] };
  latestShotGeometryRequest = published; pendingShotGeometryRequest = published;
  shotOverlay.setAttribute('aria-busy', 'true');
  shotStatus.value = `Revision ${authoring.document.revision} · measuring compiler-native geometry.`;
  if (!shotGeometryPumpRunning) shotGeometryPumpCompletion = pumpShotGeometry();
}

function republishShotGeometry(): void {
  if (!shotConfig || !latestShotGeometryRequest) return;
  if (committedShotGeometryKey === latestShotGeometryRequest.geometryKey) return;
  publishShotGeometry({ workspaceGeneration: latestShotGeometryRequest.workspaceGeneration,
    primaryElementId: latestShotGeometryRequest.primaryElementId, geometryKey: latestShotGeometryRequest.geometryKey,
    waypoints: latestShotGeometryRequest.waypoints, paths: latestShotGeometryRequest.paths,
    requestedTimes: latestShotGeometryRequest.requestedTimes });
}

function isCurrentShotGeometryRequest(request: ShotGeometryRequest): boolean {
  return latestShotGeometryRequest?.requestId === request.requestId && request.workspaceGeneration === shotGeometryGeneration
    && Boolean(shotConfig) && request.primaryElementId === shotPrimaryElementId;
}

async function pumpShotGeometry(): Promise<void> {
  if (shotGeometryPumpRunning) return;
  shotGeometryPumpRunning = true;
  try {
    while (pendingShotGeometryRequest) {
      const request = pendingShotGeometryRequest; pendingShotGeometryRequest = null;
      await processShotGeometryRequest(request);
    }
  } finally {
    shotGeometryPumpRunning = false;
    if (pendingShotGeometryRequest) shotGeometryPumpCompletion = pumpShotGeometry();
  }
}

async function awaitShotGeometryCommit(): Promise<void> {
  while (shotGeometryPumpRunning || pendingShotGeometryRequest) {
    const completion = shotGeometryPumpCompletion;
    await completion;
    if (completion === shotGeometryPumpCompletion && !shotGeometryPumpRunning && !pendingShotGeometryRequest) return;
  }
}

function refreshTrajectorySegments(): void {
  const handles = [...shotOverlay.querySelectorAll<HTMLElement>('[data-keyframe-id]')]
    .sort((left, right) => Number(left.dataset.timeMs) - Number(right.dataset.timeMs));
  const existing = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-trajectory-segment]')]
    .map((segment) => [segment.dataset.trajectorySegment!, segment]));
  const desired = new Set<string>();
  for (let index = 0; index < handles.length - 1; index += 1) {
    const from = handles[index]!; const to = handles[index + 1]!;
    const key = `${from.dataset.keyframeId!}:${to.dataset.keyframeId!}`; desired.add(key);
    let segment = existing.get(key);
    if (!segment) { segment = document.createElement('span'); segment.className = 'trajectory-segment';
      segment.dataset.trajectorySegment = key; segment.setAttribute('aria-hidden', 'true'); shotOverlay.prepend(segment); }
    const center = (handle: HTMLElement) => { const [translatedX = '0', translatedY = '0'] = handle.style.translate.split(/\s+/);
      return { x: Number.parseFloat(handle.style.left) + Number.parseFloat(handle.style.width) / 2 + (Number.parseFloat(translatedX) || 0),
        y: Number.parseFloat(handle.style.top) + Number.parseFloat(handle.style.height) / 2 + (Number.parseFloat(translatedY) || 0) }; };
    const start = center(from); const end = center(to);
    const dx = end.x - start.x; const dy = end.y - start.y;
    segment.dataset.segmentIndex = String(index + 1);
    segment.dataset.segmentLabel = `${shotMomentLabel(Number(from.dataset.timeMs))} to ${shotMomentLabel(Number(to.dataset.timeMs))}`;
    Object.assign(segment.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${Math.hypot(dx, dy)}px`,
      transform: `translateY(-1px) rotate(${Math.atan2(dy, dx)}rad)` });
  }
  for (const [key, segment] of existing) if (!desired.has(key)) segment.remove();
}

function syncReferencePathSelection(): void {
  for (const item of shotOverlay.querySelectorAll<HTMLElement>('[data-reference-segment], [data-reference-waypoint]')) {
    item.dataset.selected = String(Boolean(item.dataset.elementId && shotSelection.includes(item.dataset.elementId)));
  }
}

function renderReferencePaths(request: ShotGeometryRequest,
  samples: Awaited<ReturnType<NativePreviewController['measureTargetBoundsAtTimes']>>): void {
  const existingPoints = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-reference-waypoint]')]
    .map((point) => [point.dataset.referenceWaypoint!, point]));
  const existingSegments = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-reference-segment]')]
    .map((segment) => [segment.dataset.referenceSegment!, segment]));
  const desiredPoints = new Set<string>(); const desiredSegments = new Set<string>();
  for (const path of request.paths) {
    const selected = shotSelection.includes(path.elementId);
    const points = path.waypoints.map((waypoint) => {
      const key = `${path.elementId}:${waypoint.keyframeId}`; desiredPoints.add(key);
      const sample = samples.find((candidate) => candidate.elementId === path.elementId && candidate.timeMs === waypoint.timeMs);
      if (!sample) throw new Error('PREVIEW_REFERENCE_GEOMETRY_TARGET_MISSING');
      let point = existingPoints.get(key);
      if (!point) { point = document.createElement('span'); point.className = 'trajectory-reference-waypoint';
        point.dataset.referenceWaypoint = key; point.setAttribute('aria-hidden', 'true'); shotOverlay.append(point); }
      point.dataset.elementId = path.elementId; point.dataset.timeMs = String(waypoint.timeMs);
      point.dataset.objectIndex = String(path.objectIndex); point.dataset.selected = String(selected);
      Object.assign(point.style, { left: `${sample.bounds.left}px`, top: `${sample.bounds.top}px`, width: `${sample.bounds.width}px`,
        height: `${sample.bounds.height}px` });
      return { point, key, bounds: sample.bounds };
    });
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!; const to = points[index + 1]!; const key = `${path.elementId}:${from.key}:${to.key}`;
      desiredSegments.add(key); let segment = existingSegments.get(key);
      if (!segment) { segment = document.createElement('span'); segment.className = 'trajectory-reference-segment';
        segment.dataset.referenceSegment = key; segment.setAttribute('aria-hidden', 'true'); shotOverlay.prepend(segment); }
      const start = { x: from.bounds.left + from.bounds.width / 2, y: from.bounds.top + from.bounds.height / 2 };
      const end = { x: to.bounds.left + to.bounds.width / 2, y: to.bounds.top + to.bounds.height / 2 };
      const dx = end.x - start.x; const dy = end.y - start.y;
      segment.dataset.elementId = path.elementId; segment.dataset.objectIndex = String(path.objectIndex);
      segment.dataset.selected = String(selected);
      Object.assign(segment.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${Math.hypot(dx, dy)}px`,
        transform: `translateY(-1px) rotate(${Math.atan2(dy, dx)}rad)` });
    }
  }
  for (const [key, point] of existingPoints) if (!desiredPoints.has(key)) point.remove();
  for (const [key, segment] of existingSegments) if (!desiredSegments.has(key)) segment.remove();
}

async function processShotGeometryRequest(request: ShotGeometryRequest): Promise<void> {
  if (!isCurrentShotGeometryRequest(request)) return;
  let samples: Awaited<ReturnType<NativePreviewController['measureTargetBoundsAtTimes']>>;
  try {
    activeShotGeometrySamplers += 1; maximumActiveShotGeometrySamplers = Math.max(maximumActiveShotGeometrySamplers, activeShotGeometrySamplers);
    samples = await controller.measureTargetBoundsAtTimes(shotConfig!.targetElementIds, request.requestedTimes);
  } catch (error) {
    if (error instanceof Error && error.message === 'PREVIEW_GEOMETRY_SUPERSEDED') return;
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection = null; shotGeometry = []; shotOverlay.replaceChildren(); shotOverlay.setAttribute('aria-busy', 'false');
    const code = error instanceof Error ? error.message : 'PREVIEW_GEOMETRY_INVALID';
    shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`;
    return;
  } finally {
    activeShotGeometrySamplers -= 1;
  }
  if (!isCurrentShotGeometryRequest(request)) return;
  try {
    const projection = readShotProjection();
    if (!projection) { shotProjection = null; shotGeometry = []; shotOverlay.replaceChildren();
      shotOverlay.setAttribute('aria-busy', 'false'); return; }
    renderReferencePaths(request, samples);
    const existingHandles = [...shotOverlay.querySelectorAll<HTMLButtonElement>('[data-keyframe-id]')];
    const handlesByKeyframeId = new Map(existingHandles.map((handle) => [handle.dataset.keyframeId!, handle]));
    if (handlesByKeyframeId.size !== existingHandles.length) throw new Error('PREVIEW_GEOMETRY_HANDLE_IDENTITY_INVALID');
    const orderedHandles: HTMLButtonElement[] = [];
    for (const waypoint of request.waypoints) {
      const sample = samples.find((candidate) => candidate.elementId === request.primaryElementId && candidate.timeMs === waypoint.timeMs);
      if (!sample) throw new Error('PREVIEW_GEOMETRY_TARGET_MISSING');
      let handle = handlesByKeyframeId.get(waypoint.keyframeId);
      if (!handle) {
        handle = document.createElement('button'); handle.type = 'button'; handle.className = 'trajectory-waypoint';
        handle.addEventListener('click', () => { if (handle!.dataset.dragged === 'true') return;
          const timeMs = Number(handle!.dataset.timeMs);
          if (alignShotPreviewToMoment(timeMs)) { shotMomentMs = timeMs; renderShotWorkspace(); } });
        handle.addEventListener('pointerdown', (event) => beginWaypointDrag(event, Number(handle!.dataset.timeMs)));
      }
      handle.dataset.keyframeId = waypoint.keyframeId; handle.dataset.timeMs = String(waypoint.timeMs);
      handle.dataset.elementId = request.primaryElementId;
      handle.dataset.label = waypoint.timeMs === 0 ? 'Start' : waypoint.timeMs === 2100 ? 'Settled' : `${waypoint.timeMs} ms`;
      handle.setAttribute('aria-label', `${handle.dataset.label} compiler-native target bounds`);
      handle.setAttribute('aria-pressed', String(waypoint.timeMs === shotMomentMs));
      Object.assign(handle.style, { left: `${sample.bounds.left}px`, top: `${sample.bounds.top}px`, width: `${sample.bounds.width}px`,
        height: `${sample.bounds.height}px`, translate: '' });
      orderedHandles.push(handle);
    }
    if (!isCurrentShotGeometryRequest(request)) return;
    const desiredIds = new Set(request.waypoints.map((waypoint) => waypoint.keyframeId));
    for (const handle of existingHandles) if (!desiredIds.has(handle.dataset.keyframeId!)) handle.remove();
    for (const [index, handle] of orderedHandles.entries()) {
      const current = shotOverlay.querySelectorAll<HTMLButtonElement>('[data-keyframe-id]').item(index);
      if (current !== handle) shotOverlay.insertBefore(handle, current);
    }
    refreshTrajectorySegments();
    const nextGeometry: typeof shotGeometry = [];
    for (const sample of samples) {
      const handle = sample.elementId === request.primaryElementId
        ? shotOverlay.querySelector<HTMLElement>(`[data-keyframe-id][data-element-id="${request.primaryElementId}"][data-time-ms="${sample.timeMs}"]`) : null;
      if (!handle) continue;
      const overlayBounds = rectValue(handle.getBoundingClientRect()); const expected = projectContentBounds(projection, sample.bounds);
      const center = (rect: ProjectionRect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });
      const actualCenter = center(overlayBounds); const expectedCenter = center(expected); const dpr = projection.devicePixelRatio;
      const deltasDevicePixels = { left: Math.abs(overlayBounds.left - expected.left) * dpr,
        top: Math.abs(overlayBounds.top - expected.top) * dpr, right: Math.abs(overlayBounds.right - expected.right) * dpr,
        bottom: Math.abs(overlayBounds.bottom - expected.bottom) * dpr, centerX: Math.abs(actualCenter.x - expectedCenter.x) * dpr,
        centerY: Math.abs(actualCenter.y - expectedCenter.y) * dpr };
      if (Object.values(deltasDevicePixels).some((delta) => delta > 1)) throw new Error('PREVIEW_GEOMETRY_PARITY_EXCEEDED');
      nextGeometry.push({ elementId: sample.elementId, timeMs: sample.timeMs, contentBounds: { ...sample.bounds }, overlayBounds, deltasDevicePixels });
    }
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection = projection; shotGeometry = nextGeometry; lastCommittedShotGeometryRequestId = request.requestId;
    committedShotGeometryKey = request.geometryKey;
    shotOverlay.setAttribute('aria-busy', 'false');
    shotStatus.value = `Revision ${authoring.document.revision} · ${shotSelection.length} selected · ${shotMomentMs} ms editable against native bounds.`;
  } catch (error) {
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection = null; shotGeometry = []; shotOverlay.replaceChildren(); shotOverlay.setAttribute('aria-busy', 'false');
    const code = error instanceof Error ? error.message : 'PREVIEW_GEOMETRY_INVALID';
    shotStatus.value = `${code} · revision ${authoring.document.revision} unchanged.`;
  }
}

function shotStageProjection() {
  const { widthCssPixels, heightCssPixels } = controller.sourceSize();
  if (!Number.isSafeInteger(widthCssPixels) || widthCssPixels <= 0
    || !Number.isSafeInteger(heightCssPixels) || heightCssPixels <= 0) return null;
  const widthMicrounits = widthCssPixels * 1_000_000; const heightMicrounits = heightCssPixels * 1_000_000;
  if (!Number.isSafeInteger(widthMicrounits) || !Number.isSafeInteger(heightMicrounits)) return null;
  return { stageDigest: sha256Hex(`${compiled.exportDigest}\0${widthMicrounits}\0${heightMicrounits}`), widthMicrounits, heightMicrounits };
}

type DirectPoseKind = 'move' | 'scale' | 'rotate';
type ShotPose = { translateXMicrounits: number; translateYMicrounits: number; scalePpm: number; rotateMicrodegrees: number };

function selectedShotPose(): { pose: ShotPose; target: { elementId: string; trackId: string; keyframeId: string; expectedTransform: string } } | null {
  if (!shotPrimaryElementId) return null;
  const selected = projectTrajectorySelection(authoring.document, [shotPrimaryElementId], shotMomentMs);
  const trajectory = projectTransformTrajectory(authoring.document, shotPrimaryElementId);
  if (!selected.eligible || !trajectory.eligible) return null;
  const waypoint = trajectory.waypoints.find((point) => point.timeMs === shotMomentMs);
  return waypoint ? { pose: { ...waypoint.pose }, target: selected.targets[0]! } : null;
}

function normalizeRotation(degrees: number): number {
  if (degrees === 180 || degrees === -180) return degrees;
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function directPoseOperation(nextPose: ShotPose, kind: DirectPoseKind): AuthoringOperation | null {
  const selected = selectedShotPose(); const stage = shotStageProjection();
  if (!selected || !stage) return null;
  if (kind === 'move' && required<HTMLInputElement>('[data-move-together]').checked && shotSelection.length > 1) {
    return buildWaypointTranslateOperation(shotMomentMs, nextPose.translateXMicrounits, nextPose.translateYMicrounits);
  }
  return { ...operationEnvelope(), kind: 'motion.transform-pose.set', ...selected.target, payload: { pose: nextPose, stage } };
}

function beginDirectPoseGesture(event: PointerEvent, kind: DirectPoseKind): void {
  if (event.button !== 0 || !shotPrimaryElementId || !alignShotPreviewToMoment(shotMomentMs)) return;
  const selected = selectedShotPose(); const projection = readShotProjection();
  if (!selected || !projection) return;
  event.preventDefault(); const surface = event.currentTarget as HTMLButtonElement;
  surface.setPointerCapture(event.pointerId);
  const start = { clientX: event.clientX, clientY: event.clientY }; const startPose = selected.pose;
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${shotPrimaryElementId}"]`);
  const targetRect = target?.getBoundingClientRect(); const iframeRect = iframe.getBoundingClientRect();
  const center = targetRect ? { x: iframeRect.left + (targetRect.left + targetRect.width / 2) * projection.scaleX,
    y: iframeRect.top + (targetRect.top + targetRect.height / 2) * projection.scaleY } : { x: start.clientX, y: start.clientY };
  const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
  const startRadius = Math.max(1, Math.hypot(event.clientX - center.x, event.clientY - center.y));
  const committedAtGestureStart = { html: compiled.html, css: compiled.css }; let latest: { operation: AuthoringOperation;
    html: string; css: string } | null = null; let moved = false; let frame: number | null = null; let cancelled = false;
  const preview = () => { frame = null; const draft = latest; if (!draft || cancelled) return;
    void controller.applyCompilerCssDraft(draft.css).then(() => schedulePreviewSelection()).catch(() => undefined); };
  const move = (next: PointerEvent) => {
    const dx = (next.clientX - start.clientX) / projection.scaleX; const dy = (next.clientY - start.clientY) / projection.scaleY;
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1;
    if (!moved) return;
    let pose: ShotPose = { ...startPose };
    if (kind === 'move') pose = { ...pose, translateXMicrounits: startPose.translateXMicrounits + Math.round(dx * 1_000_000),
      translateYMicrounits: startPose.translateYMicrounits + Math.round(dy * 1_000_000) };
    if (kind === 'scale') pose = { ...pose, scalePpm: Math.round(Math.max(.25, Math.min(3, startPose.scalePpm / 1_000_000
      * Math.hypot(next.clientX - center.x, next.clientY - center.y) / startRadius)) * 1_000_000) };
    if (kind === 'rotate') pose = { ...pose, rotateMicrodegrees: Math.round(normalizeRotation(startPose.rotateMicrodegrees / 1_000_000
      + (Math.atan2(next.clientY - center.y, next.clientX - center.x) - startAngle) * 180 / Math.PI) * 1_000_000) };
    const operation = directPoseOperation(pose, kind); if (!operation) return;
    const reduced = dispatchAuthoringOperation(authoring, operation); if (!reduced.ok) return;
    const draft = compileMotionDocument(reduced.state.document); latest = { operation, html: draft.html, css: draft.css };
    if (frame === null) frame = requestAnimationFrame(preview);
    shotStatus.value = `${kind} draft · release to commit or press Escape to cancel.`;
  };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); if (frame !== null) cancelAnimationFrame(frame); };
  const cancel = () => { cancelled = true; cleanup(); latest = null; void controller.restoreCommittedCompilerCss().then(() => {
    shotStatus.value = `Draft cancelled · revision ${authoring.document.revision} unchanged.`; schedulePreviewSelection(); }); };
  const escape = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); cancel(); };
  const finish = () => { cleanup(); const draft = latest; if (!moved || !draft) { latest = null; return; }
    void controller.applyCompilerCssDraft(draft.css).then(() => dispatch(draft.operation, undefined, undefined, {
      schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: committedAtGestureStart.html,
      oldCompilerCss: committedAtGestureStart.css, newCommittedHtml: draft.html, newCompilerCss: draft.css,
    })).then((result) => { shotStatus.value = result.ok ? `${kind} applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`;
      renderShotWorkspace(); }).catch(async () => { await controller.restoreCommittedCompilerCss(); }); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('keydown', escape);
}

async function handleDirectPoseKeyboard(event: KeyboardEvent, kind: 'body' | 'scale' | 'rotate'): Promise<void> {
  const selected = selectedShotPose(); if (!selected) return;
  if ((event.key === 'Enter' || event.key === ' ') && kind !== 'body') {
    event.preventDefault(); const value = kind === 'scale' ? `${selected.pose.scalePpm / 1_000_000} uniform scale`
      : `${selected.pose.rotateMicrodegrees / 1_000_000} degrees rotation`; shotStatus.value = value; return;
  }
  const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (!arrows.includes(event.key) && !(kind === 'rotate' && ['Home', 'End'].includes(event.key))) return;
  event.preventDefault(); const pose = { ...selected.pose }; let operationKind: DirectPoseKind = kind === 'body' ? 'move' : kind;
  if (kind === 'body' && event.altKey) operationKind = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'scale' : 'rotate';
  if (operationKind === 'move') { const step = (event.shiftKey ? 10 : 1) * 1_000_000;
    if (event.key === 'ArrowLeft') pose.translateXMicrounits -= step; if (event.key === 'ArrowRight') pose.translateXMicrounits += step;
    if (event.key === 'ArrowUp') pose.translateYMicrounits -= step; if (event.key === 'ArrowDown') pose.translateYMicrounits += step; }
  if (operationKind === 'scale') { const step = (event.shiftKey ? .25 : .05) * 1_000_000;
    const increase = event.key === 'ArrowUp' || event.key === 'ArrowRight'; pose.scalePpm = Math.round(Math.max(250_000, Math.min(3_000_000, pose.scalePpm + (increase ? step : -step)))); }
  if (operationKind === 'rotate') { const step = event.shiftKey ? 15 : 1; const current = pose.rotateMicrodegrees / 1_000_000;
    const next = event.key === 'Home' ? -180 : event.key === 'End' ? 180 : normalizeRotation(current + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : -step));
    pose.rotateMicrodegrees = Math.round(next * 1_000_000); }
  const operation = directPoseOperation(pose, operationKind); if (!operation) return;
  const result = await dispatch(operation); shotStatus.value = result.ok ? `${operationKind} applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`;
  renderShotWorkspace(); (event.currentTarget as HTMLElement).focus({ preventScroll: true });
}

async function applyShotPose(): Promise<void> {
  if (!shotConfig || !shotPrimaryElementId) return; const primary = shotPrimaryElementId;
  const selected = projectTrajectorySelection(authoring.document, [primary], shotMomentMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  const controls = shotPoseForm.elements as unknown as Record<string, HTMLInputElement>;
  const nextPose = { translateXMicrounits: Math.round(Number(controls.x!.value) * 1_000_000),
    translateYMicrounits: Math.round(Number(controls.y!.value) * 1_000_000),
    scalePpm: Math.round(Number(controls.scale!.value) * 1_000_000),
    rotateMicrodegrees: Math.round(Number(controls.rotate!.value) * 1_000_000) };
  const moveTogether = required<HTMLInputElement>('[data-move-together]').checked && shotSelection.length > 1;
  const stage = shotStageProjection();
  if (!stage) { shotStatus.value = 'TRAJECTORY_STAGE_INVALID · unchanged.'; return; }
  const operation = moveTogether
    ? buildWaypointTranslateOperation(shotMomentMs, nextPose.translateXMicrounits, nextPose.translateYMicrounits)
    : { ...operationEnvelope(), kind: 'motion.transform-pose.set' as const, ...selected.targets[0]!, payload: { pose: nextPose, stage } };
  if (!operation) { shotStatus.value = `${shotStatus.value} · unchanged.`; return; }
  const result = await dispatch(operation); shotStatus.value = result.ok ? `Pose applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`; renderShotWorkspace();
}

function buildWaypointTranslateOperation(momentMs: number, nextXMicrounits: number, nextYMicrounits: number): AuthoringOperation | null {
  const selected = projectTrajectorySelection(authoring.document, shotSelection, momentMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return null; }
  const primary = projectTransformTrajectory(authoring.document, shotPrimaryElementId!);
  if (!primary.eligible) { shotStatus.value = primary.code; return null; }
  const current = primary.waypoints.find((point) => point.timeMs === momentMs);
  if (!current) { shotStatus.value = 'TRAJECTORY_MOMENT_MISSING'; return null; }
  const stage = shotStageProjection(); if (!stage) { shotStatus.value = 'TRAJECTORY_STAGE_INVALID'; return null; }
  const deltaXPpm = Math.round((nextXMicrounits - current.pose.translateXMicrounits) * 1_000_000 / stage.widthMicrounits);
  const deltaYPpm = Math.round((nextYMicrounits - current.pose.translateYMicrounits) * 1_000_000 / stage.heightMicrounits);
  if (!Number.isSafeInteger(stage.widthMicrounits * deltaXPpm / 1_000_000)
    || !Number.isSafeInteger(stage.heightMicrounits * deltaYPpm / 1_000_000)) {
    shotStatus.value = 'AUTHORING_TRAJECTORY_PRECISION_INVALID'; return null;
  }
  return { ...operationEnvelope(), kind: 'motion.transform-waypoints.translate', payload: { targets: selected.targets,
    deltaXPpm, deltaYPpm, stage } };
}

function beginWaypointDrag(event: PointerEvent, momentMs: number): void {
  if (event.button !== 0 || shotMode !== 'path' || !alignShotPreviewToMoment(momentMs)) return;
  shotMomentMs = momentMs; renderShotWorkspace();
  const primaryElementId = shotPrimaryElementId!;
  const primary = projectTransformTrajectory(authoring.document, primaryElementId); if (!primary.eligible) return;
  const current = primary.waypoints.find((point) => point.timeMs === momentMs); if (!current) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked && shotSelection.length > 1;
  const selected = projectTrajectorySelection(authoring.document, editTogether ? [...shotSelection] : [primaryElementId], momentMs);
  if (!selected.eligible) return;
  const stage = shotStageProjection(); if (!stage) return;
  const projection = readShotProjection(); if (!projection) return;
  const committedAtGestureStart = { html: compiled.html, css: compiled.css };
  const gestureGeneration = ++waypointGestureGeneration;
  waypointReleasePhase = 'idle';
  activeWaypointDraft = null; waypointDraftMoveCount = 0; waypointDraftAppliedCount = 0; waypointDraftFailure = null;
  if (waypointDraftFrame !== null) { cancelAnimationFrame(waypointDraftFrame); waypointDraftFrame = null; }
  const envelope = operationEnvelope();
  event.preventDefault(); const surface = event.currentTarget as HTMLButtonElement; surface.setPointerCapture(event.pointerId);
  const feedbackHandle = surface.matches('[data-keyframe-id]') ? surface
    : shotOverlay.querySelector<HTMLElement>(`[data-element-id="${primaryElementId}"][data-time-ms="${momentMs}"]`);
  const start = { clientX: event.clientX, clientY: event.clientY }; let moved = false;
  const move = (next: PointerEvent) => {
    let deltaXPpm: number; let deltaYPpm: number;
    try { ({ deltaXPpm, deltaYPpm } = previewPointerDeltaToPpm(projection, start, { clientX: next.clientX, clientY: next.clientY })); }
    catch { shotStatus.value = `PREVIEW_POINTER_INVERSE_INVALID · revision ${authoring.document.revision} unchanged.`; return; }
    const candidate: AuthoringOperation = { ...envelope, kind: 'motion.transform-waypoints.translate', payload: {
      targets: selected.targets, deltaXPpm, deltaYPpm, stage } };
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1;
    if (moved) { surface.dataset.dragged = 'true'; if (feedbackHandle) feedbackHandle.style.translate = `${next.clientX - start.clientX}px ${next.clientY - start.clientY}px`;
      refreshTrajectorySegments(); }
    if (!moved || !Number.isSafeInteger(stage.widthMicrounits * deltaXPpm / 1_000_000)
      || !Number.isSafeInteger(stage.heightMicrounits * deltaYPpm / 1_000_000)) return;
    const reduced = dispatchAuthoringOperation(authoring, candidate); if (!reduced.ok) return;
    let draftCompiled;
    try { draftCompiled = compileMotionDocument(reduced.state.document); } catch { return; }
    const nextDraft = { operation: candidate, commandBytes: canonicalJson(makeTrajectoryCommand(candidate as Parameters<typeof makeTrajectoryCommand>[0], activeBranchId)),
      compiledHtml: draftCompiled.html, compiledCss: draftCompiled.css, exportDigest: draftCompiled.exportDigest };
    activeWaypointDraft = nextDraft; waypointDraftMoveCount += 1;
    if (waypointDraftFrame === null) waypointDraftFrame = requestAnimationFrame(() => {
      waypointDraftFrame = null; const frameDraft = activeWaypointDraft;
      waypointDraftApply = waypointDraftApply.then(async () => {
        if (!frameDraft || gestureGeneration !== waypointGestureGeneration || activeWaypointDraft !== frameDraft) return;
        await controller.applyCompilerCssDraft(frameDraft.compiledCss); waypointDraftAppliedCount += 1;
      }).catch(async (error: unknown) => {
        waypointDraftFailure = error instanceof Error ? error.message : 'PREVIEW_DRAFT_INVALID'; activeWaypointDraft = null;
        await controller.restoreCommittedCompilerCss();
        shotStatus.value = `${waypointDraftFailure} · revision ${authoring.document.revision} unchanged.`;
      });
    });
    shotStatus.value = `Trajectory draft · ${primaryElementId}/${current.keyframeId} · release to commit or press Escape to cancel.`;
  };
  const cancelDraftFrame = () => { if (waypointDraftFrame !== null) { cancelAnimationFrame(waypointDraftFrame); waypointDraftFrame = null; } };
  const clearTerminalFeedback = () => { if (feedbackHandle) feedbackHandle.style.translate = ''; refreshTrajectorySegments();
    queueMicrotask(() => { delete surface.dataset.dragged; }); };
  const detachGesture = (retainTerminalFeedback: boolean) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('keydown', cancelKeyboard);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (!retainTerminalFeedback) clearTerminalFeedback();
  };
  const restoreCommitted = () => { const cancelGeneration = ++waypointGestureGeneration; cancelDraftFrame(); activeWaypointDraft = null;
    void waypointDraftApply.then(async () => { if (cancelGeneration !== waypointGestureGeneration) return;
      await controller.restoreCommittedCompilerCss(); schedulePreviewSelection();
      waypointReleasePhase = 'idle'; shotStatus.value = `Draft cancelled · revision ${authoring.document.revision} unchanged.`; }); };
  const finish = () => { const releasedDraft = activeWaypointDraft; detachGesture(Boolean(moved && releasedDraft));
    const releaseGeneration = ++waypointGestureGeneration; cancelDraftFrame();
    if (moved && releasedDraft) {
      waypointReleasePhase = 'flushing-latest';
      waypointDraftApply = waypointDraftApply.then(async () => {
        if (releaseGeneration !== waypointGestureGeneration) return;
        await controller.applyCompilerCssDraft(releasedDraft.compiledCss); waypointDraftAppliedCount += 1;
      });
      void waypointDraftApply.then(async () => {
        if (releaseGeneration !== waypointGestureGeneration || waypointDraftFailure) return;
        waypointReleasePhase = 'committing';
        const result = await dispatch(releasedDraft.operation, undefined, undefined, {
          schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: committedAtGestureStart.html,
          oldCompilerCss: committedAtGestureStart.css, newCommittedHtml: releasedDraft.compiledHtml,
          newCompilerCss: releasedDraft.compiledCss,
        });
        if (!result.ok) await controller.restoreCommittedCompilerCss();
        else { waypointReleasePhase = 'publishing-geometry'; await awaitShotGeometryCommit(); }
      }).catch(async (error: unknown) => {
        waypointDraftFailure = error instanceof Error ? error.message : 'PREVIEW_DRAFT_INVALID';
        await controller.restoreCommittedCompilerCss();
        shotStatus.value = `${waypointDraftFailure} · revision ${authoring.document.revision} unchanged.`;
      }).finally(() => { if (releaseGeneration === waypointGestureGeneration) activeWaypointDraft = null;
        waypointReleasePhase = 'idle'; clearTerminalFeedback(); });
    } else if (moved) { restoreCommitted(); }
    else { waypointReleasePhase = 'idle'; activeWaypointDraft = null; }
  };
  const cancelPointer = () => { detachGesture(false); restoreCommitted(); };
  const cancelKeyboard = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); detachGesture(false); restoreCommitted(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', cancelPointer, { once: true }); window.addEventListener('keydown', cancelKeyboard);
}

function readShotTimingDrafts(): { landing: number; settled: number } | null {
  const landingInput = required<HTMLInputElement>('[data-shot-landing]');
  const settledInput = required<HTMLInputElement>('[data-shot-settled]');
  landingInput.setCustomValidity(''); landingInput.removeAttribute('aria-invalid');
  settledInput.setCustomValidity(''); settledInput.removeAttribute('aria-invalid');
  const landing = Number(landingInput.value); const settled = Number(settledInput.value);
  const reject = (input: HTMLInputElement, message: string): null => {
    input.setCustomValidity(message); input.setAttribute('aria-invalid', 'true'); input.focus();
    shotStatus.value = `${message} Revision ${authoring.document.revision} unchanged.`;
    return null;
  };
  if (!Number.isSafeInteger(landing) || landing < 1 || landing > 2099) {
    return reject(landingInput, 'Landing must be a whole number from 1 to 2099 ms.');
  }
  if (!Number.isSafeInteger(settled) || settled < 2 || settled > 2100) {
    return reject(settledInput, 'Settled must be a whole number from 2 to 2100 ms.');
  }
  if (landing >= settled) {
    landingInput.setAttribute('aria-invalid', 'true');
    return reject(settledInput, 'Settled must be later than landing.');
  }
  return { landing, settled };
}

async function applyShotTimes(): Promise<void> {
  if (!shotConfig) return; const timing = readShotTimingDrafts(); if (!timing) return; const { landing, settled } = timing;
  let selected = projectTrajectorySelection(authoring.document, shotConfig.targetElementIds, shotConfig.landedMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  if (landing === shotConfig.landedMs) { shotStatus.value = `Times already applied at revision ${authoring.document.revision}.`; return; }
  const result = await dispatch({ ...operationEnvelope(), kind: 'motion.keyframe-group-time.set', payload: { targets: selected.targets,
    sourceTimeMs: shotConfig.landedMs, targetTimeMs: landing, landingTimeMs: landing,
    settledTimeMs: settled } });
  shotStatus.value = result.ok ? `Times applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`;
  renderShotWorkspace();
}

function effectiveShotTimings(targets: Array<{ trackId: string; elementId: string; keyframeId: string; expectedTransform: string }>): Array<TimingFunction> | null {
  const effectiveTimings = targets.map((target): TimingFunction | null => {
    const track = authoring.document.tracks.find((item) => item.id === target.trackId && item.elementId === target.elementId && item.property === 'transform');
    const rule = track && authoring.document.rules.find((item) => item.id === track.ruleId);
    const ruleTrack = rule?.tracks.find((item) => item.property === 'transform');
    const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId && item.value === target.expectedTransform);
    const application = track && authoring.document.applications.find((item) => item.slots.some((slot) => slot.id === track.slotId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === track?.slotId) ?? -1;
    const slot = application?.slots[slotIndex];
    const binding = application?.bindings.find((item) => item.elementId === target.elementId);
    if (!track || !ruleTrack || !keyframe || !application || !slot || binding?.delayOverridesMs[slotIndex] === undefined) return null;
    return keyframe.easing ?? slot.timingFunction;
  });
  return effectiveTimings.some((timing) => timing === null) ? null : effectiveTimings as Array<TimingFunction>;
}

async function applyShotEasing(): Promise<void> {
  if (!shotConfig) return;
  const selected = projectTrajectorySelection(authoring.document, shotConfig.targetElementIds, shotConfig.landedMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  const effectiveTimings = effectiveShotTimings(selected.targets);
  if (!effectiveTimings) { shotStatus.value = 'AUTHORING_TRAJECTORY_EASING_MISSING · unchanged.'; return; }
  const expectedEasing = effectiveTimings[0]!;
  if (effectiveTimings.some((timing) => canonicalJson(timing) !== canonicalJson(expectedEasing))) {
    shotStatus.value = 'AUTHORING_TRAJECTORY_EASING_NON_UNIFORM · unchanged.'; return;
  }
  const value = required<HTMLSelectElement>('[data-shot-easing]').value as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  const result = await dispatch({ ...operationEnvelope(), kind: 'motion.keyframe-group-easing.set', payload: { targets: selected.targets, expectedEasing, easing: { kind: 'keyword', value } } });
  shotStatus.value = result.ok ? `Easing applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`; renderShotWorkspace();
}

async function applyShotHold(): Promise<void> {
  if (!shotConfig) return; const timing = readShotTimingDrafts(); if (!timing) return; const { landing, settled } = timing;
  const selected = projectTrajectorySelection(authoring.document, shotConfig.targetElementIds, 2100); if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return; }
  const result = await dispatch({ ...operationEnvelope(), kind: 'motion.settled-hold.set', payload: { targets: selected.targets, sourceTimeMs: 2100, settledTimeMs: settled, landingTimeMs: landing, boundaryTimeMs: 2100 } });
  shotStatus.value = result.ok ? `Settled hold applied at revision ${authoring.document.revision}.` : `${result.code} · unchanged.`; renderShotWorkspace();
}

function required<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error('EDITOR_ELEMENT_MISSING');
  return element;
}
