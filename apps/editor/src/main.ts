import payload from 'virtual:motion-document';
import { compileMotionDocument, type CompilerResult } from '../../../packages/css-compiler/src/index.js';
import {
  canonicalJson,
  canonicalContentBytes,
  createAuthoringState,
  cueTargetSnapshots,
  deriveCueId,
  dispatchAuthoringOperation,
  projectCueReplacement,
  projectShotWorkspace,
  projectTrajectorySelection,
  projectTransformTrajectory,
  projectTrackCreationEligibility,
  sha256Hex,
  type AuthoringOperation,
  type AuthoringState,
  type AuthoringCue,
  type CueAuthoringOperation,
  type CueSemantic,
  type StructuralAuthoringElementId,
  type TimingFunction,
  type OperationIntentPayload,
  type PreparedOperationIntent,
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
import { MotionPreparationError, MotionServiceClient, commandSchema, makeBranchCreateCommand, makeClaimControlCommand,
  makeOperationIntentCommand, makeTrajectoryCommand,
  type CommitMetadata, type MotionCommand, type MotionDiagnostic } from '../../../packages/motion-protocol/src/index.ts';
import { mountReviewHandoff } from './review-handoff.ts';
import './styles.css';

export const authoring: { value: AuthoringState } = { value: createAuthoringState(payload.document) };
export const compiled: { value: CompilerResult } = { value: payload.compiled };
export const serviceClient = payload.serviceBacked && payload.humanCapability
  ? new MotionServiceClient('', (...args) => fetch(...args), { actor: 'human', capability: payload.humanCapability })
  : payload.serviceBacked ? (() => { throw new Error('EDITOR_CAPABILITY_REQUIRED'); })() : null;
export const lastCommit: { value: CommitMetadata | null } = { value: null };
export const immutableRefetchCount: { value: number } = { value: 0 };
export const pendingRevision: { value: number | null } = { value: null };
export type PublicationState = 'settled' | 'pending' | 'failed';
export const publicationState: { value: PublicationState } = { value: 'settled' };
export const publicationFailureCode: { value: string | null } = { value: null };
export const activeBranchId: { value: string } = { value: 'main' };
export type DurableWorkspace = Awaited<ReturnType<MotionServiceClient['workspace']>>;
export type DurableBranches = Awaited<ReturnType<MotionServiceClient['branches']>>;
export type DurableClaims = Awaited<ReturnType<MotionServiceClient['activeClaims']>>;
export type DurableActivity = Awaited<ReturnType<MotionServiceClient['activity']>>;
export type DurableContextSnapshot = { workspace: DurableWorkspace; branches: DurableBranches; claims: DurableClaims; activity: DurableActivity };
export const durableWorkspace: { value: DurableWorkspace | null } = { value: null };
export const durableBranches: { value: DurableBranches | null } = { value: null };
export const durableClaims: { value: DurableClaims | null } = { value: null };
export const durableActivity: { value: DurableActivity | null } = { value: null };
export const lastServiceDiagnostic: { value: MotionDiagnostic | null } = { value: null };
export const publicationTestGate: { value: { promise: Promise<void>; release: () => void } | null } = { value: null };
export const failNextPublicationForTest: { value: boolean } = { value: false };
if (serviceClient) {
  const head = await serviceClient.head(payload.document.documentId);
  authoring.value = createAuthoringState(head.document);
  compiled.value = compileMotionDocument(head.document);
}
export const operationClientId = crypto.randomUUID();
export const operationSequence: { value: number } = { value: 0 };
export const creationChoices = [
  { elementId: 'el_a2849ff826f3e167', label: 'Cursor' },
  { elementId: 'el_2dbee68b1ea318c8', label: 'Orb' },
] as const;
export const statusCopyElementId = 'el_1f3f2908e4fd2401';
export const selectedCreationElementId: { value: StructuralAuthoringElementId | null } = { value: null };
export const creationDraftDirty: { value: boolean } = { value: false };
export const selectedTrackId: { value: string | null } = { value: null };
export const selectedKeyframeId: { value: string | null } = { value: null };
export const hasExplicitKeyframeSelection: { value: boolean } = { value: false };
export const unavailableSelection: { value: boolean } = { value: false };
export const unavailableCreation: { value: boolean } = { value: false };
export const lastCommitSeq: { value: number } = { value: 0 };
export const reconciliation: { value: Promise<void> } = { value: Promise.resolve() };
export const branchGeneration: { value: number } = { value: 0 };
export const eventSubscription: { value: { close(): void } | null } = { value: null };
export const eventSubscriptionGeneration: { value: number } = { value: 0 };
export const reconciliationFailures = new Map<number, number>();
export const reconnectTimer: { value: ReturnType<typeof setTimeout> | null } = { value: null };
export const draftConflictRevision: { value: number | null } = { value: null };
export const draftStaleBaseRevision: { value: number | null } = { value: null };
export const detachedCueKinds = new Set<CueSemantic['kind']>();
export const cuePathDefaultsInitialized: { value: boolean } = { value: false };
export const reusableCueWorkspace = payload.cueWorkspace?.schemaVersion === 'motion.editor-cue-workspace.v2';
export const reusableTargetOptions = `<option value="">Choose on canvas</option>${authoring.value.document.elements
  .map((element, index) => `<option value="${element.id}">Object ${index + 1}</option>`).join('')}`;
export const reusableTextTargetOptions = `<option value="">Choose text on canvas</option>${authoring.value.document.elements
  .filter((element) => element.editableText !== undefined)
  .map((element, index) => `<option value="${element.id}">Text ${index + 1}</option>`).join('')}`;
export const reusableHoldTargetOptions = holdTargetOptions(1000);

document.body.innerHTML = editorShellMarkup();
export { editorShellMarkup } from './editor-shell.js';
import { editorShellMarkup } from './editor-shell.js';

export const iframe = required<HTMLIFrameElement>('[data-preview]');
export const controller = new NativePreviewController(iframe);
export const reviewHandoff = serviceClient && payload.humanCapability && new URLSearchParams(location.search).has('review-handoff') ? mountReviewHandoff({
  root: required<HTMLElement>('.editor-shell'), serviceUrl: '', capability: payload.humanCapability,
  documentId: authoring.value.document.documentId, branchId: () => activeBranchId.value, revision: () => authoring.value.document.revision,
  canonicalDigest: () => durableWorkspace.value?.canonicalDigest ?? sha256Hex(canonicalJson(authoring.value.document)), compiled: () => compiled.value,
}) : null;
export const scrubber = required<HTMLInputElement>('[data-scrub]');
export const playhead = required<HTMLOutputElement>('[data-playhead]');
export const status = required<HTMLOutputElement>('[data-operation-status]');
export const valueInput = required<HTMLInputElement>('[data-value]');
export const timeInput = required<HTMLInputElement>('[data-time]');
export const valueButton = required<HTMLButtonElement>('[data-value-form] button');
export const timeButton = required<HTMLButtonElement>('[data-time-form] button');
export const undoButton = required<HTMLButtonElement>('[data-undo]');
export const redoButton = required<HTMLButtonElement>('[data-redo]');
export const createTrackButton = required<HTMLButtonElement>('[data-create-track]');
export const addMidpointButton = required<HTMLButtonElement>('[data-add-midpoint]');
export const removeMidpointButton = required<HTMLButtonElement>('[data-remove-midpoint]');
export const durationInput = required<HTMLInputElement>('[data-duration]');
export const delayInput = required<HTMLInputElement>('[data-delay]');
export const easingInput = required<HTMLSelectElement>('[data-easing]');
export const setDurationButton = required<HTMLButtonElement>('[data-set-duration]');
export const setDelayButton = required<HTMLButtonElement>('[data-set-delay]');
export const setEasingButton = required<HTMLButtonElement>('[data-set-easing]');
export const previewStage = required<HTMLElement>('.preview-stage');
export const previewCanvas = required<HTMLElement>('[data-preview-canvas]');
export const previewObjectOverlay = required<HTMLElement>('[data-preview-object-overlay]');
export const previewSelection = required<HTMLElement>('[data-preview-selection]');
export const previewShotToolbar = required<HTMLElement>('[data-preview-shot-toolbar]');
export const previewShotObject = required<HTMLElement>('[data-preview-shot-object]');
export const previewShotState = required<HTMLOutputElement>('[data-preview-shot-state]');
export const previewShotActions = required<HTMLElement>('[data-preview-shot-actions]');
export const branchSelect = document.querySelector<HTMLSelectElement>('[data-active-branch]');
export const branchForm = document.querySelector<HTMLFormElement>('[data-branch-form]');
export const revokeForm = document.querySelector<HTMLFormElement>('[data-revoke-form]');
export const draftConflict = required<HTMLElement>('[data-draft-conflict]');
export const shotWorkspace = required<HTMLElement>('[data-shot-workspace]');
export const shotTargets = required<HTMLFieldSetElement>('[data-shot-targets]');
export const shotMoments = required<HTMLFieldSetElement>('[data-shot-moments]');
export const shotOverlay = required<HTMLElement>('[data-trajectory-overlay]');
export const shotPoseForm = required<HTMLFormElement>('[data-pose-form]');
export const shotAdvancedToggle = required<HTMLButtonElement>('[data-shot-advanced-toggle]');
export const shotAdvancedDrawer = required<HTMLElement>('[data-shot-advanced-drawer]');
export const shotStatus = required<HTMLOutputElement>('[data-shot-status]');
export const shotControlFeedback = required<HTMLOutputElement>('[data-shot-control-feedback]');
export const shotGuidance = required<HTMLElement>('[data-shot-guidance]');
export const shotRecovery = required<HTMLElement>('[data-shot-recovery]');
export const cueWorkspace = document.querySelector<HTMLElement>('[data-cue-workspace]');
export const cueTargetOverlay = document.querySelector<HTMLElement>('[data-cue-target-overlay]');
export const cuePathOverlay = document.querySelector<HTMLElement>('[data-cue-path-overlay]');
export type CueCanvasRole = 'cursor' | 'pulse' | 'reveal';
export type CursorPathAuthoringCue = AuthoringCue & { semantic: Extract<CueSemantic, { kind: 'cursor-path' }> };
export type PathAuthoringCue = AuthoringCue & { semantic: Extract<CueSemantic, { kind: 'cursor-path' | 'drag' }> };
export const cuePickRole: { value: CueCanvasRole | null } = { value: null };
export const reusablePickControl: { value: HTMLSelectElement | null } = { value: null };
export const cueEditingKind: { value: CueSemantic['kind'] | null } = { value: null };
export const cueCanvasGeneration: { value: number } = { value: 0 };
export const cueCanvasFrame: { value: number | null } = { value: null };
export const cuePathGestureGeneration: { value: number } = { value: 0 };
export const shotConfig: { value: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] } | null } = { value: null };
export const shotSelection: { value: string[] } = { value: [] };
export const shotPrimaryElementId: { value: string | null } = { value: null };
export const shotMomentMs: { value: number } = { value: 700 };
export const shotMode: { value: 'pose' | 'path' } = { value: 'path' };
export const shotProjection: { value: PreviewOverlayProjection | null } = { value: null };
export const shotGeometry: { value: Array<{ elementId: string; timeMs: number; contentBounds: ProjectionRect; overlayBounds: ProjectionRect;
  deltasDevicePixels: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number } }> } = { value: [] };
export const shotGeometryGeneration: { value: number } = { value: 0 };
export type ShotGeometryRequest = { requestId: number; workspaceGeneration: number; primaryElementId: string;
  geometryKey: string; waypoints: Array<{ keyframeId: string; timeMs: number }>;
  paths: Array<{ elementId: string; objectIndex: number; waypoints: Array<{ keyframeId: string; timeMs: number }> }>;
  requestedTimes: number[] };
export const shotGeometryRequestId: { value: number } = { value: 0 };
export const latestShotGeometryRequest: { value: ShotGeometryRequest | null } = { value: null };
export const pendingShotGeometryRequest: { value: ShotGeometryRequest | null } = { value: null };
export const shotGeometryPumpRunning: { value: boolean } = { value: false };
export const shotGeometryPumpCompletion: { value: Promise<void> } = { value: Promise.resolve() };
export const activeShotGeometrySamplers: { value: number } = { value: 0 };
export const maximumActiveShotGeometrySamplers: { value: number } = { value: 0 };
export const lastCommittedShotGeometryRequestId: { value: number | null } = { value: null };
export const committedShotGeometryKey: { value: string | null } = { value: null };
export const mountedPreviewGeneration: { value: number } = { value: 0 };
export const activeWaypointDraft: { value: {
  operation: AuthoringOperation;
  intent: OperationIntentPayload;
  commandBytes: string;
  compiledHtml: string;
  compiledCss: string;
  exportDigest: string;
} | null } = { value: null };
export const waypointDraftApply: { value: Promise<void> } = { value: Promise.resolve() };
export const waypointDraftFrame: { value: number | null } = { value: null };
export const waypointDraftMoveCount: { value: number } = { value: 0 };
export const waypointDraftAppliedCount: { value: number } = { value: 0 };
export const waypointDraftFailure: { value: string | null } = { value: null };
export const waypointGestureGeneration: { value: number } = { value: 0 };
export const waypointReleasePhase: { value: 'idle' | 'flushing-latest' | 'committing' | 'publishing-geometry' } = { value: 'idle' };
export const playbackFeedbackFrame: { value: number | null } = { value: null };
export const lastPreviewCommitPromotion: { value: { schemaVersion: 'motion.preview-css-commit-promotion.v1'; attempted: boolean;
  promoted: boolean; fallbackCode: string | null } } = { value: { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: false,
  promoted: false, fallbackCode: null } };
export * from './editor-advanced.js';
import { setShotAdvancedOpen } from './editor-advanced.js';


shotAdvancedToggle.addEventListener('click', () => setShotAdvancedOpen(shotAdvancedDrawer.hidden));
required<HTMLButtonElement>('[data-shot-advanced-close]').addEventListener('click', () => setShotAdvancedOpen(false, true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !shotAdvancedDrawer.hidden) setShotAdvancedOpen(false, true);
});
required<HTMLButtonElement>('[data-keep-draft]').addEventListener('click', () => resolveDraftConflict(true));
required<HTMLButtonElement>('[data-discard-draft]').addEventListener('click', () => resolveDraftConflict(false));
for (const button of shotWorkspace.querySelectorAll<HTMLButtonElement>('[data-shot-mode]')) button.addEventListener('click', () => {
  selectShotMode(shotMode.value === 'path' ? 'pose' : 'path');
});
required<HTMLInputElement>('[data-move-together]').addEventListener('change', (event) => {
  const editBoth = event.currentTarget as HTMLInputElement;
  shotSelection.value = editBoth.checked && shotConfig.value ? [...shotConfig.value.targetElementIds] : shotPrimaryElementId.value ? [shotPrimaryElementId.value] : [];
  renderShotWorkspace();
});
shotPoseForm.addEventListener('submit', (event) => { event.preventDefault(); void applyShotPose(); });
required<HTMLButtonElement>('[data-shot-apply-easing]').addEventListener('click', () => void applyShotEasing());
required<HTMLButtonElement>('[data-shot-remove-moment]').addEventListener('click', () => void removeShotMoment());
required<HTMLButtonElement>('[data-shot-hold]').addEventListener('click', () => void applyShotHold());
required<HTMLButtonElement>('[data-shot-retry]').addEventListener('click', () => initializeSeedWorkspace());
required<HTMLButtonElement>('[data-shot-inspect]').addEventListener('click', () => {
  setShotAdvancedOpen(true);
  const inspector = required<HTMLDetailsElement>('.inspect-panel'); inspector.open = true; inspector.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
export const shotMomentTime = required<HTMLInputElement>('[data-shot-moment-time]');
shotMomentTime.addEventListener('input', () => {
  required<HTMLOutputElement>('[data-shot-moment-time-output]').value = `${shotMomentTime.value} ms`;
  scrub(Number(shotMomentTime.value));
});
shotMomentTime.addEventListener('change', () => void applyShotMomentTime(Number(shotMomentTime.value)));
for (const input of document.querySelectorAll<HTMLInputElement>('[data-shot-settled]')) {
  input.addEventListener('input', () => {
    for (const timingInput of document.querySelectorAll<HTMLInputElement>('[data-shot-landing], [data-shot-settled]')) {
      timingInput.setCustomValidity(''); timingInput.removeAttribute('aria-invalid');
    }
    shotStatus.value = `Timing draft not applied · revision ${authoring.value.document.revision} unchanged.`;
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
export const previewSelectionLabel = required<HTMLElement>('[data-preview-selection-label]');
export const appliedDuration = required<HTMLOutputElement>('[data-applied-duration]');
export const appliedDelay = required<HTMLOutputElement>('[data-applied-delay]');
export const appliedEasing = required<HTMLOutputElement>('[data-applied-easing]');
export const insertHoldButton = required<HTMLButtonElement>('[data-insert-hold]');
export const holdStatus = required<HTMLOutputElement>('[data-hold-status]');

if (payload.cueWorkspace) {
for (const form of document.querySelectorAll<HTMLFormElement>('[data-cue-form]')) form.addEventListener('submit', (event) => {
  event.preventDefault(); void submitCueForm(form);
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-cue-cancel-edit]')) button.addEventListener('click', () => {
  cueEditingKind.value = null; renderCueCanvas();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-cue-pick]')) button.addEventListener('click', () => {
  const role = button.dataset.cuePick as CueCanvasRole;
  cuePickRole.value = role;
  scrub(cuePickRole.value === 'reveal' ? 1200 : 700);
  renderCueCanvas();
  announceCueStatus(`Click the ${cueRoleLabel(cuePickRole.value).toLowerCase()} directly on the canvas.`, false);
});
for (const select of document.querySelectorAll<HTMLSelectElement>('[data-cue-cursor], [data-cue-pulse], [data-cue-reveal]')) {
  select.addEventListener('change', () => { cuePickRole.value = null; renderCueCanvas(); });
}
for (const select of document.querySelectorAll<HTMLSelectElement>('[data-reusable-target]')) {
  select.addEventListener('change', () => { reusablePickControl.value = null; renderCueCanvas(); });
  select.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? select.options.length - 1
      : Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)));
    select.selectedIndex = next; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reusable-pick]')) {
  button.addEventListener('click', () => {
    const form = button.closest<HTMLFormElement>('[data-cue-form]');
    reusablePickControl.value = form?.elements.namedItem(button.dataset.reusablePick ?? '') as HTMLSelectElement | null;
    renderCueCanvas();
    announceCueStatus('Click the intended object directly on the canvas.', false);
  });
}
const holdForm = document.querySelector<HTMLFormElement>('[data-cue-form="hold"]');
const holdEnter = holdForm?.elements.namedItem('enter');
if (holdForm && holdEnter instanceof HTMLInputElement) {
  holdEnter.addEventListener('change', () => refreshHoldTargetOptions(holdForm));
}
}

wireAuthoringControls();
export { wireAuthoringControls } from './editor-wiring.js';
import { wireAuthoringControls } from './editor-wiring.js';
export const reducedToggle = required<HTMLButtonElement>('[data-reduced-toggle]');
export const reducedPanel = required<HTMLElement>('[data-reduced-motion-panel]');
reducedPanel.querySelector('pre')!.textContent = authoring.value.document.reducedMotion.css;
reducedToggle.addEventListener('click', () => {
  const expanded = reducedToggle.getAttribute('aria-expanded') === 'true';
  reducedToggle.setAttribute('aria-expanded', String(!expanded));
  reducedPanel.hidden = expanded;
});

renderProjection();
await mountPreview(compiled.value.html, compiled.value.css);
activateCueLayout();
initializeSeedWorkspace();
if (serviceClient) await refreshDurableContext();
schedulePreviewSelection();
setPublicationState('settled');
document.querySelector('main')!.setAttribute('data-editor-ready', 'true');
window.addEventListener('resize', () => {
  if (previewStage.clientWidth <= 0) return;
  configurePreviewCanvas(); schedulePreviewSelection(); scheduleCueCanvas(); if (shotConfig.value) renderShotWorkspace();
});

export const inspectShotWorkspace = () => ({ open: Boolean(shotConfig.value), mode: shotMode.value, momentMs: shotMomentMs.value,
  selectedElementIds: [...shotSelection.value], revision: authoring.value.document.revision,
  previewMatchesCompiler: controller.readCompilerCommitState().committedHtml === compiled.value.html,
  previewNavigationSourceMatchesCompiler: controller.readCompilerCommitState().lastNavigationSourceHtml === compiled.value.html,
  compilerCommit: controller.readCompilerCommitState(),
  lastPreviewCommitPromotion: { ...lastPreviewCommitPromotion.value },
  waypointReleasePhase: waypointReleasePhase.value,
  compilerDraft: controller.readCompilerDraftState(),
  projection: shotProjection.value && { ...shotProjection.value },
  geometryPump: { running: shotGeometryPumpRunning.value, activeSamplers: activeShotGeometrySamplers.value,
    maximumActiveSamplers: maximumActiveShotGeometrySamplers.value, latestRequestId: latestShotGeometryRequest.value?.requestId ?? null,
    pendingRequestId: pendingShotGeometryRequest.value?.requestId ?? null, lastCommittedRequestId: lastCommittedShotGeometryRequestId.value },
  geometry: shotGeometry.value.map((sample) => ({ ...sample, contentBounds: { ...sample.contentBounds }, overlayBounds: { ...sample.overlayBounds },
    deltasDevicePixels: { ...sample.deltasDevicePixels } })),
  activeDraft: activeWaypointDraft.value && { commandBytes: activeWaypointDraft.value.commandBytes,
    compiledHtml: activeWaypointDraft.value.compiledHtml, compiledCss: activeWaypointDraft.value.compiledCss, exportDigest: activeWaypointDraft.value.exportDigest,
    moveCount: waypointDraftMoveCount.value, appliedCount: waypointDraftAppliedCount.value,
    controllerDraft: controller.readCompilerDraftState(),
    operation: structuredClone(activeWaypointDraft.value.operation) },
});

window.__motionEditor = {
  get compiledHtml() { return compiled.value.html; },
  get trackIds() { return buildTimeline(authoring.value.document).rows.map((row) => row.trackId); },
  get cueIds() { return authoring.value.document.cues.map((cue) => cue.id); },
  get canonicalProjection() { return buildTimeline(authoring.value.document); },
  readState: () => controller.readState(),
  inspectAuthoring: () => ({
    documentId: authoring.value.document.documentId,
    revision: authoring.value.document.revision,
    contentDigest: sha256Hex(canonicalContentBytes(authoring.value.document)),
    exportDigest: compiled.value.exportDigest,
    compiledHtml: compiled.value.html,
    undoCount: serviceClient ? Number(durableWorkspace.value?.history.undoAvailable ?? false) : authoring.value.undo.length,
    redoCount: serviceClient ? Number(durableWorkspace.value?.history.redoAvailable ?? false) : authoring.value.redo.length,
    consumedOperationIds: [...authoring.value.consumedOperationIds],
    selectedTrackId: selectedTrackId.value as string,
    selectedKeyframeId: selectedKeyframeId.value as string,
    selectedCreationElementId: selectedCreationElementId.value,
    unavailableSelection: unavailableSelection.value,
    unavailableCreation: unavailableCreation.value,
    draftConflictRevision: draftConflictRevision.value,
    draftStaleBaseRevision: draftStaleBaseRevision.value,
    draftDirty: captureDraft().dirty,
    draftValues: captureDraft().values,
    lastCommitSeq: lastCommitSeq.value,
    pendingRevision: pendingRevision.value,
    publicationPending: publicationState.value === 'pending',
    publicationState: publicationState.value,
    publicationFailureCode: publicationFailureCode.value,
    serviceBacked: Boolean(serviceClient),
    activeBranchId: activeBranchId.value,
    immutableRefetchCount: immutableRefetchCount.value,
    lastCommit: lastCommit.value,
  }),
  inspectCollaboration: () => ({ workspace: durableWorkspace.value && structuredClone(durableWorkspace.value),
    branches: durableBranches.value && structuredClone(durableBranches.value), claims: durableClaims.value && structuredClone(durableClaims.value),
    activity: durableActivity.value && structuredClone(durableActivity.value), diagnostic: lastServiceDiagnostic.value && structuredClone(lastServiceDiagnostic.value) }),
  inspectReviewHandoff: () => reviewHandoff?.inspect() ?? null,
  dispatch,
  openShotWorkspace,
  inspectShotWorkspace,
  inspectCueWorkspace: () => ({ active: Boolean(cueWorkspace), pickRole: cuePickRole.value,
    selectedRoles: { cursor: Boolean(cueRoleSelect('cursor').value), pulse: Boolean(cueRoleSelect('pulse').value),
      reveal: Boolean(cueRoleSelect('reveal').value) },
    targetCandidateCount: Number(cueTargetOverlay?.dataset.candidateCount ?? 0),
    pathHandleCount: cuePathOverlay?.querySelectorAll('[data-waypoint-index]').length ?? 0,
    authoredCues: authoring.value.document.cues.filter((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1')
      .map((cue) => ({ kind: cue.semantic.kind, semantic: structuredClone(cue.semantic), generatedTrackCount: cue.generatedTrackIds.length })),
  }),
  switchBranch,
  disconnectEvents: () => { eventSubscription.value?.close(); eventSubscriptionGeneration.value += 1; },
  reconnectEvents: connectEvents,
  delayNextPublication: () => {
    if (publicationTestGate.value) return;
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    publicationTestGate.value = { promise, release };
  },
  releasePublication: () => { publicationTestGate.value?.release(); publicationTestGate.value = null; },
  failNextPublication: () => { failNextPublicationForTest.value = true; },
  retryPublication: async () => {
    if (!serviceClient || publicationState.value !== 'failed') return false;
    const immutable = await serviceClient.head(authoring.value.document.documentId, activeBranchId.value);
    clearShotControlFeedback();
    await applyImmutable(immutable, true);
    status.value = `Change applied. Revision ${authoring.value.document.revision}.`;
    status.dataset.kind = 'success';
    return true;
  },
};

export type EditorPersistentOperation = AuthoringOperation | PreparedOperationIntent;
export * from './editor-dispatch.js';
import { rejectUnavailablePublication, dispatch, serviceCommandForOperation, prepareAndDispatchIntent, durableUndoAvailable, durableRedoAvailable, findCommittedOperation, fetchDurableContext, publishDurableContext, refreshDurableContext } from './editor-dispatch.js';
export * from './editor-feedback.js';
import { setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic } from './editor-feedback.js';
import type { ShotControlAction } from './editor-feedback.js';


if (serviceClient) connectEvents();
export * from './editor-events.js';
import { connectEvents } from './editor-events.js';
export * from './editor-collaboration.js';
import { reconcileCommit, switchBranch, createBranch, revokeClaim, serializeServiceCommand, clearKeyframeSelection, applyImmutable } from './editor-collaboration.js';
import type { ImmutableHead } from './editor-collaboration.js';


export type DraftSnapshot = { dirty: boolean; values: Record<string, string>; dirtyFields: Record<string, boolean>;
  creationElementId: StructuralAuthoringElementId | null; creationDirty: boolean; staleBaseRevision: number | null };
export * from './editor-drafts.js';
import { captureDraft, restoreDraft, resolveDraftConflict, dirtyStaleBase, resolveAcceptedCreationDraft, resolveAcceptedOperationDraft, operationEnvelope, withCreatedTrack, makeEdit, makeHistory, nextOperationId } from './editor-drafts.js';
export * from './editor-render.js';
import { renderProjection } from './editor-render.js';

export * from './editor-cue-forms.js';
import { submitCueForm, renderAuthoredCues, reconcileCueEditingProjection, hydrateCueForm, terminateCue, cueDiagnosticMessage, announceCueStatus, cueRoleLabel, cueRoleSelect, activateCueLayout, scheduleCueCanvas, renderCueCanvas, renderReusableTargetOverlay, holdTargetOptions, attachedHoldSupportsBoundary, refreshHoldTargetOptions } from './editor-cue-forms.js';
export * from './editor-cue-canvas.js';
import { missingCueTarget, initializeCuePathDefaults, renderCueTargetOverlay, renderCuePathOverlay, cueVisualBounds, cuePathSegment, positionCuePathSegment, refreshCuePathSegments, beginCuePathDrag } from './editor-cue-canvas.js';
export * from './editor-timeline.js';
import { updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection } from './editor-timeline.js';
export * from './editor-preview.js';
import { mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets } from './editor-preview.js';
export * from './editor-shot-workspace.js';
import { openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar } from './editor-shot-workspace.js';
export * from './editor-shot-geometry.js';
import { renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest } from './editor-shot-geometry.js';
export * from './editor-shot-actions.js';
import { shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold } from './editor-shot-actions.js';
import type { DirectPoseKind, ShotPose } from './editor-shot-actions.js';


export function required<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error('EDITOR_ELEMENT_MISSING');
  return element;
}
