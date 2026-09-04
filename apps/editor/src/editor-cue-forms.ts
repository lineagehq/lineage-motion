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
import { rejectUnavailablePublication, dispatch, serviceCommandForOperation, prepareAndDispatchIntent, durableUndoAvailable, durableRedoAvailable, findCommittedOperation, fetchDurableContext, publishDurableContext, refreshDurableContext } from './editor-dispatch.js';
import { connectEvents } from './editor-events.js';
import { reconcileCommit, switchBranch, createBranch, revokeClaim, serializeServiceCommand, clearKeyframeSelection, applyImmutable } from './editor-collaboration.js';
import type { ImmutableHead } from './editor-collaboration.js';
import { captureDraft, restoreDraft, resolveDraftConflict, dirtyStaleBase, resolveAcceptedCreationDraft, resolveAcceptedOperationDraft, operationEnvelope, withCreatedTrack, makeEdit, makeHistory, nextOperationId } from './editor-drafts.js';
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, missingCueTarget, initializeCuePathDefaults, renderCueTargetOverlay, renderCuePathOverlay, cueVisualBounds, cuePathSegment, positionCuePathSegment, refreshCuePathSegments, beginCuePathDrag, updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection, mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export async function submitCueForm(form: HTMLFormElement): Promise<void> {
  const kind = form.dataset.cueForm as CueSemantic['kind'];
  const number = (name: string): number => Number(new FormData(form).get(name));
  const cursorTargetId = required<HTMLSelectElement>('[data-cue-cursor]').value;
  const pulseTargetId = required<HTMLSelectElement>('[data-cue-pulse]').value;
  const revealTargetId = required<HTMLSelectElement>('[data-cue-reveal]').value;
  const existing = authoring.value.document.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
    && cue.semantic.kind === kind);
  let semantic: CueSemantic;
  if (kind === 'cursor-path') {
    const startMs = number('start'); const arriveMs = number('arrive');
    semantic = { kind, cursorTargetId, startMs, arriveMs, easing: { kind: 'keyword', value: 'ease-out' }, waypoints: [
      { timeMs: startMs, xPpm: Math.round(number('startX') * 10_000), yPpm: Math.round(number('startY') * 10_000) },
      { timeMs: arriveMs, xPpm: Math.round(number('endX') * 10_000), yPpm: Math.round(number('endY') * 10_000) },
    ] };
  } else if (kind === 'reveal') {
    semantic = { kind, targetIds: [revealTargetId], startMs: number('start'), completeMs: number('complete') };
  } else if (kind === 'click') {
    const reveal = authoring.value.document.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
      && cue.semantic.kind === 'reveal');
    semantic = { kind, cursorTargetId, pulseTargetId, arriveMs: number('arrive'), pressMs: number('press'),
      releaseMs: number('release'), pulseEndMs: number('pulseEnd'), pressScalePpm: Math.round(number('scale') * 10_000),
      pulseRadiusPpm: Math.round(number('radius') * 1_000_000), pulseOpacityPpm: 700_000,
      ...(reveal ? { revealCueId: reveal.id } : {}) };
  } else if (kind === 'type') {
    semantic = { kind, targetId: String(new FormData(form).get('target')), startMs: number('start'),
      completeMs: number('complete'), stepCount: number('stepCount') };
  } else if (kind === 'select') {
    const data = new FormData(form); const highlightTargetId = String(data.get('highlight') ?? '');
    semantic = { kind, cursorTargetId: String(data.get('cursor')), selectedTargetId: String(data.get('selected')),
      ...(highlightTargetId ? { highlightTargetId } : {}), approachMs: number('approach'), chooseMs: number('choose'),
      settleMs: number('settle') };
  } else if (kind === 'drag') {
    const data = new FormData(form); const moveStartMs = number('moveStart'); const arriveMs = number('arrive');
    const prior = existing?.semantic.kind === 'drag' ? existing.semantic : null;
    const interior = prior ? prior.waypoints.slice(1, -1).map((point) => ({ ...point,
      timeMs: Math.round(moveStartMs + (point.timeMs - prior.moveStartMs)
        / (prior.arriveMs - prior.moveStartMs) * (arriveMs - moveStartMs)) })) : [{ timeMs: Math.round((moveStartMs + arriveMs) / 2),
      xPpm: Math.round((number('startX') + number('endX')) * 5_000),
      yPpm: Math.round((number('startY') + number('endY')) * 5_000) }];
    semantic = { kind, cursorTargetId: String(data.get('cursor')), draggedTargetId: String(data.get('dragged')),
      approachMs: number('approach'), pressMs: number('press'), moveStartMs, arriveMs, releaseMs: number('release'),
      grabOffsetXPpm: Math.round(number('gripX') * 10_000), grabOffsetYPpm: Math.round(number('gripY') * 10_000),
      waypoints: [{ timeMs: moveStartMs, xPpm: Math.round(number('startX') * 10_000), yPpm: Math.round(number('startY') * 10_000) },
        ...interior, { timeMs: arriveMs, xPpm: Math.round(number('endX') * 10_000), yPpm: Math.round(number('endY') * 10_000) }] };
  } else {
    const enterMs = number('enter'); const durationMs = number('duration');
    semantic = { kind, targetIds: new FormData(form).getAll('target').map(String), enterMs, durationMs,
      exitMs: enterMs + durationMs };
  }
  const intent: OperationIntentPayload = existing
    ? { kind: 'motion.cue.update', cueId: existing.id, semantic }
    : { kind: 'motion.cue.create', creationKey: `editor-${kind}`, semantic };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { cueEditingKind.value = null; renderCueCanvas(); }
  const label = kind === 'cursor-path' ? 'Cursor path' : kind[0]!.toUpperCase() + kind.slice(1);
  announceCueStatus(result.ok ? `${label} ${existing ? 'updated' : 'created'} at revision ${authoring.value.document.revision}.`
    : cueDiagnosticMessage(result.code ?? 'UNKNOWN', kind), !result.ok, result.ok ? undefined : result.code);
}

export function renderAuthoredCues(): void {
  reconcileCueEditingProjection();
  const container = required<HTMLElement>('[data-authored-cues]'); container.replaceChildren();
  const createLabels: Record<CueSemantic['kind'], string> = {
    'cursor-path': 'Create cursor path', reveal: 'Create reveal', click: 'Create click', type: 'Create type',
    select: 'Create select', drag: 'Create drag', hold: 'Create hold',
  };
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-cue-form]')) {
    form.querySelector('button[type="submit"]')!.textContent = createLabels[form.dataset.cueForm as CueSemantic['kind']];
  }
  for (const cue of authoring.value.document.cues.filter((candidate): candidate is AuthoringCue => candidate.schemaVersion === 'motion.authoring-cue.v1')) {
    const card = document.createElement('article'); card.dataset.authoredCue = cue.semantic.kind; card.dataset.cueId = cue.id;
    card.innerHTML = `<div><strong>${cue.label}</strong><span>${cue.generatedTrackIds.length} generated track${cue.generatedTrackIds.length === 1 ? '' : 's'}</span></div>
      <div><button type="button" data-cue-edit>Edit</button><button type="button" data-cue-detach>Detach</button><button type="button" data-cue-delete>Delete</button></div>`;
    card.querySelector<HTMLButtonElement>('[data-cue-edit]')!.addEventListener('click', () => {
      cueEditingKind.value = cue.semantic.kind; renderCueCanvas();
      document.querySelector<HTMLFormElement>(`[data-cue-form="${cue.semantic.kind}"]`)?.focus();
    });
    card.querySelector<HTMLButtonElement>('[data-cue-detach]')!.addEventListener('click', () => void terminateCue(cue, 'motion.cue.detach'));
    card.querySelector<HTMLButtonElement>('[data-cue-delete]')!.addEventListener('click', () => void terminateCue(cue, 'motion.cue.delete'));
    container.append(card);
    const form = document.querySelector<HTMLFormElement>(`[data-cue-form="${cue.semantic.kind}"]`);
    if (form) {
      form.querySelector('button[type="submit"]')!.textContent = `Update ${cue.label.toLowerCase()}`;
      hydrateCueForm(form, cue.semantic);
    }
  }
}

export function reconcileCueEditingProjection(): void {
  if (!cueEditingKind.value || authoring.value.document.cues.some((cue) => cue.schemaVersion === 'motion.authoring-cue.v1'
    && cue.semantic.kind === cueEditingKind.value)) return;
  const form = document.querySelector<HTMLFormElement>(`[data-cue-form="${cueEditingKind.value}"]`);
  form?.reset();
  for (const control of form?.querySelectorAll<HTMLInputElement>('[aria-invalid]') ?? []) control.removeAttribute('aria-invalid');
  const output = required<HTMLOutputElement>('[data-cue-status]');
  output.value = '';
  output.dataset.kind = 'ready';
  delete output.dataset.diagnosticCode;
  cueEditingKind.value = null;
}

export function hydrateCueForm(form: HTMLFormElement, semantic: CueSemantic): void {
  const set = (name: string, value: number) => {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    if (input) input.value = String(value);
  };
  if (semantic.kind === 'cursor-path') {
    required<HTMLSelectElement>('[data-cue-cursor]').value = semantic.cursorTargetId;
    set('start', semantic.startMs); set('arrive', semantic.arriveMs);
    set('startX', semantic.waypoints[0]!.xPpm / 10_000); set('startY', semantic.waypoints[0]!.yPpm / 10_000);
    set('endX', semantic.waypoints.at(-1)!.xPpm / 10_000); set('endY', semantic.waypoints.at(-1)!.yPpm / 10_000);
  } else if (semantic.kind === 'reveal') {
    required<HTMLSelectElement>('[data-cue-reveal]').value = semantic.targetIds[0]!;
    set('start', semantic.startMs); set('complete', semantic.completeMs);
  } else if (semantic.kind === 'click') {
    required<HTMLSelectElement>('[data-cue-cursor]').value = semantic.cursorTargetId;
    required<HTMLSelectElement>('[data-cue-pulse]').value = semantic.pulseTargetId;
    set('arrive', semantic.arriveMs); set('press', semantic.pressMs); set('release', semantic.releaseMs);
    set('pulseEnd', semantic.pulseEndMs); set('scale', semantic.pressScalePpm / 10_000);
    set('radius', semantic.pulseRadiusPpm / 1_000_000);
  } else if (semantic.kind === 'type') {
    (form.elements.namedItem('target') as HTMLSelectElement).value = semantic.targetId;
    set('start', semantic.startMs); set('complete', semantic.completeMs); set('stepCount', semantic.stepCount);
  } else if (semantic.kind === 'select') {
    (form.elements.namedItem('cursor') as HTMLSelectElement).value = semantic.cursorTargetId;
    (form.elements.namedItem('selected') as HTMLSelectElement).value = semantic.selectedTargetId;
    (form.elements.namedItem('highlight') as HTMLSelectElement).value = semantic.highlightTargetId ?? '';
    set('approach', semantic.approachMs); set('choose', semantic.chooseMs); set('settle', semantic.settleMs);
  } else if (semantic.kind === 'drag') {
    (form.elements.namedItem('cursor') as HTMLSelectElement).value = semantic.cursorTargetId;
    (form.elements.namedItem('dragged') as HTMLSelectElement).value = semantic.draggedTargetId;
    set('approach', semantic.approachMs); set('press', semantic.pressMs); set('moveStart', semantic.moveStartMs);
    set('arrive', semantic.arriveMs); set('release', semantic.releaseMs); set('gripX', semantic.grabOffsetXPpm / 10_000);
    set('gripY', semantic.grabOffsetYPpm / 10_000); set('startX', semantic.waypoints[0]!.xPpm / 10_000);
    set('startY', semantic.waypoints[0]!.yPpm / 10_000); set('endX', semantic.waypoints.at(-1)!.xPpm / 10_000);
    set('endY', semantic.waypoints.at(-1)!.yPpm / 10_000);
  } else {
    const target = form.elements.namedItem('target') as HTMLSelectElement;
    for (const option of target.options) option.selected = semantic.targetIds.includes(option.value);
    set('enter', semantic.enterMs); set('duration', semantic.durationMs);
  }
}

export async function terminateCue(cue: AuthoringCue, kind: 'motion.cue.delete' | 'motion.cue.detach'): Promise<void> {
  const intent: OperationIntentPayload = { kind, cueId: cue.id };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok && kind === 'motion.cue.detach') detachedCueKinds.add(cue.semantic.kind);
  announceCueStatus(result.ok ? `${cue.label} ${kind.endsWith('detach')
    ? 'detached to ordinary tracks. The compiled result is unchanged; use Undo to restore guided editing' : 'deleted'}.`
    : cueDiagnosticMessage(result.code ?? 'UNKNOWN', cue.semantic.kind), !result.ok, result.ok ? undefined : result.code);
}

export function cueDiagnosticMessage(code: string, kind: CueSemantic['kind']): string {
  if (code === 'CUE_REPLACEMENT_INVALID') return `${kind === 'click' ? 'Click' : kind === 'reveal' ? 'Reveal' : 'Cursor path'} tracks are ordinary tracks now. Use Undo to restore guided editing before changing this beat.`;
  if (kind === 'click' && (code === 'CUE_UPDATE_INVALID' || code === 'CUE_MOMENT_INVALID' || code === 'CUE_TIMING_INVALID' || code.includes('CHRONOLOGY'))) {
    return 'Timing must stay in order: Arrive < Press < Release < Pulse end. Adjust the highlighted values and try again.';
  }
  return `That change could not be applied. Revision ${authoring.value.document.revision} is unchanged.`;
}

export function announceCueStatus(message: string, error: boolean, diagnosticCode?: string): void {
  const output = required<HTMLOutputElement>('[data-cue-status]'); output.value = message; output.dataset.kind = error ? 'error' : 'success';
  if (diagnosticCode) output.dataset.diagnosticCode = diagnosticCode; else delete output.dataset.diagnosticCode;
}

export function cueRoleLabel(role: CueCanvasRole): string {
  return role === 'cursor' ? 'Cursor' : role === 'pulse' ? 'Click target' : 'Reveal target';
}

export function cueRoleSelect(role: CueCanvasRole): HTMLSelectElement {
  return required<HTMLSelectElement>(role === 'cursor' ? '[data-cue-cursor]'
    : role === 'pulse' ? '[data-cue-pulse]' : '[data-cue-reveal]');
}

export function activateCueLayout(): void {
  if (!cueWorkspace) return;
  const layout = required<HTMLElement>('.primary-layout');
  layout.insertBefore(cueWorkspace, required<HTMLElement>('.workflow'));
  required<HTMLElement>('[data-cue-history-slot]').append(required<HTMLElement>('.workflow-footer'));
  required<HTMLElement>('.editor-shell').classList.add('cue-active');
  required<HTMLElement>('.topbar h1').textContent = 'Build a guided interaction';
  required<HTMLElement>('.purpose').textContent = 'Choose the objects, shape the cursor path, and preview the result on one canvas.';
  required<HTMLElement>('#preview-heading').textContent = 'Canvas';
  renderCueCanvas();
}

export function scheduleCueCanvas(): void {
  if (!cueWorkspace) return;
  if (cueCanvasFrame.value !== null) cancelAnimationFrame(cueCanvasFrame.value);
  cueCanvasFrame.value = requestAnimationFrame(() => { cueCanvasFrame.value = null; renderCueCanvas(); });
}

export function renderCueCanvas(): void {
  if (!cueWorkspace || !cueTargetOverlay || !cuePathOverlay) return;
  const selections = new Map<CueCanvasRole, string>([['cursor', cueRoleSelect('cursor').value],
    ['pulse', cueRoleSelect('pulse').value], ['reveal', cueRoleSelect('reveal').value]]);
  const authoredKinds = new Set(authoring.value.document.cues.filter((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1')
    .map((cue) => cue.semantic.kind));
  reconcileCueEditingProjection();
  if (!reusableCueWorkspace && !missingCueTarget(selections) && !authoredKinds.has('cursor-path') && !cuePathDefaultsInitialized.value) initializeCuePathDefaults(selections);
  const cueSequence: CueSemantic['kind'][] = reusableCueWorkspace ? ['hold', 'type', 'select', 'drag']
    : ['cursor-path', 'reveal', 'click'];
  const detachedKind = cueSequence.find((kind) => detachedCueKinds.has(kind) && !authoredKinds.has(kind));
  const missingRole = reusableCueWorkspace ? undefined : (['cursor', 'pulse', 'reveal'] as const).find((role) => !selections.get(role));
  if (!cuePickRole.value && missingRole) cuePickRole.value = missingRole;
  const workflowStep = cueEditingKind.value ?? missingRole ? (cueEditingKind.value ? `edit-${cueEditingKind.value}` : `pick-${missingRole}`)
    : detachedKind ? `detached-${detachedKind}`
    : cueSequence.find((kind) => !authoredKinds.has(kind)) ?? 'complete';
  cueWorkspace.dataset.step = workflowStep;
  const guidance: Record<string, string> = {
    'pick-cursor': 'The canvas is active. Click the object that should move as the cursor.', 'pick-pulse': 'Now click the object the cursor should press.',
    'pick-reveal': 'Now click the content that should appear.', 'cursor-path': 'Create the movement, then drag Start and Arrive directly on the canvas.',
    reveal: 'Add the reveal using the suggested timing.', click: 'Add the click response to finish the interaction.',
    complete: 'The interaction is ready. Drag the path handles or press Play to review it.',
    'detached-cursor-path': 'The cursor path is now ordinary motion and still compiles exactly as before. Use Undo to restore guided editing.',
    'detached-reveal': 'The reveal is now ordinary motion and still compiles exactly as before. Use Undo to restore guided editing.',
    'detached-click': 'The click response is now ordinary motion and still compiles exactly as before. Use Undo to restore guided editing.',
    'edit-cursor-path': 'Adjust the cursor movement, then save your changes.', 'edit-reveal': 'Adjust the reveal timing, then save your changes.',
    'edit-click': 'Adjust the click response, then save your changes.',
    type: 'Choose existing text, then add a stepped reveal.', select: 'Choose the cursor, selected object, and optional highlight.',
    drag: 'Choose the cursor and dragged object, then set their shared path.', hold: 'Choose animated motion with an explicit enter boundary.',
    'edit-type': 'Adjust the text reveal, then save your changes.', 'edit-select': 'Adjust the selection choreography, then save your changes.',
    'edit-drag': 'Adjust the coordinated drag, then save your changes.', 'edit-hold': 'Adjust the hold duration, then save your changes.',
  };
  required<HTMLElement>('[data-cue-guidance]').textContent = guidance[workflowStep] ?? guidance.complete!;
  required<HTMLElement>('#cue-workspace-heading').textContent = workflowStep === 'pick-cursor' ? 'Choose the moving cursor object'
    : workflowStep === 'pick-pulse' ? 'Click the destination object' : workflowStep === 'pick-reveal' ? 'Click the content to reveal'
      : workflowStep === 'cursor-path' ? 'Shape the cursor movement' : workflowStep === 'reveal' ? 'Add the reveal'
        : workflowStep === 'click' ? 'Add the click response' : workflowStep === 'complete' ? 'Interaction ready'
          : workflowStep.startsWith('detached-') ? 'Guided editing detached'
            : reusableCueWorkspace && !workflowStep.startsWith('edit-') ? `Add ${workflowStep}` : 'Edit the interaction';
  required<HTMLElement>('[data-cue-progress-count]').textContent = workflowStep === 'complete' ? 'Ready'
    : workflowStep.startsWith('edit-') ? 'Editing' : missingRole ? 'Choose objects' : 'Build motion';
  required<HTMLElement>('.preview-title p').textContent = workflowStep.startsWith('pick-')
    ? guidance[workflowStep]! : workflowStep === 'complete' ? 'Drag Start or Arrive, or press Play.' : guidance[workflowStep] ?? guidance.complete!;
  for (const role of ['cursor', 'pulse', 'reveal'] as const) {
    const selected = Boolean(selections.get(role));
    const card = required<HTMLElement>(`[data-cue-role-card="${role}"]`);
    card.dataset.selected = String(selected);
    card.dataset.current = String(workflowStep === `pick-${role}`);
    required<HTMLOutputElement>(`[data-cue-role-status="${role}"]`).value = selected ? 'Selected' : workflowStep === `pick-${role}` ? 'Choose on canvas' : 'Waiting';
    const button = required<HTMLButtonElement>(`[data-cue-pick="${role}"]`);
    button.setAttribute('aria-pressed', String(cuePickRole.value === role));
    button.hidden = !selected;
    button.textContent = 'Change';
  }
  for (const form of document.querySelectorAll<HTMLFormElement>('[data-cue-form]')) {
    const kind = form.dataset.cueForm as CueSemantic['kind'];
    form.hidden = workflowStep !== kind && workflowStep !== `edit-${kind}`;
    const cancel = form.querySelector<HTMLButtonElement>('[data-cue-cancel-edit]');
    if (cancel) cancel.hidden = workflowStep !== `edit-${kind}`;
  }
  required<HTMLElement>('[data-cue-complete]').hidden = workflowStep !== 'complete';
  const advanced = required<HTMLDetailsElement>('.cue-advanced');
  advanced.hidden = authoredKinds.size === 0;
  const cursorSelected = Boolean(selections.get('cursor'));
  const pulseSelected = Boolean(selections.get('pulse'));
  const revealSelected = Boolean(selections.get('reveal'));
  required<HTMLButtonElement>('[data-cue-form="cursor-path"] button[type="submit"]').disabled = !cursorSelected || detachedKind === 'cursor-path';
  required<HTMLButtonElement>('[data-cue-form="reveal"] button[type="submit"]').disabled = !revealSelected || detachedKind === 'reveal';
  required<HTMLButtonElement>('[data-cue-form="click"] button[type="submit"]').disabled = !(cursorSelected && pulseSelected) || detachedKind === 'click';
  if (reusableCueWorkspace) {
    required<HTMLElement>('.cue-role-step').hidden = true;
    renderReusableTargetOverlay();
    void renderCuePathOverlay(++cueCanvasGeneration.value);
    for (const kind of ['type', 'select', 'drag', 'hold'] as const) {
      const button = required<HTMLButtonElement>(`[data-cue-form="${kind}"] button[type="submit"]`);
      const selects = [...required<HTMLFormElement>(`[data-cue-form="${kind}"]`).querySelectorAll<HTMLSelectElement>('select[required], select[data-reusable-target]')];
      button.disabled = selects.some((select) => select.name !== 'highlight' && !select.value) || detachedKind === kind;
    }
  } else {
    renderCueTargetOverlay(selections);
    void renderCuePathOverlay(++cueCanvasGeneration.value);
  }
}

export function renderReusableTargetOverlay(): void {
  if (!cueTargetOverlay) return;
  cueTargetOverlay!.replaceChildren();
  if (!reusablePickControl.value) { cueTargetOverlay!.hidden = true; cueTargetOverlay!.dataset.picking = 'false'; return; }
  const allowed = new Set([...reusablePickControl.value.options].map((option) => option.value).filter(Boolean));
  const entries = authoring.value.document.elements.map((element) => ({ elementId: element.id, bounds: cueVisualBounds(element.id) }))
    .filter((entry): entry is { elementId: string; bounds: ProjectionRect } => allowed.has(entry.elementId) && Boolean(entry.bounds))
    .sort((left, right) => left.elementId.localeCompare(right.elementId));
  for (const [index, entry] of entries.entries()) {
    const marker = document.createElement('span'); marker.className = 'cue-target-candidate';
    marker.dataset.cueTargetCandidate = ''; marker.dataset.elementId = entry.elementId; marker.dataset.objectLabel = `Object ${index + 1}`;
    Object.assign(marker.style, { left: `${entry.bounds.left}px`, top: `${entry.bounds.top}px`,
      width: `${entry.bounds.width}px`, height: `${entry.bounds.height}px` });
    cueTargetOverlay!.append(marker);
  }
  cueTargetOverlay!.dataset.candidateCount = String(entries.length); cueTargetOverlay!.dataset.picking = 'true'; cueTargetOverlay!.hidden = false;
  cueTargetOverlay!.onclick = (event) => {
    const overlayRect = cueTargetOverlay!.getBoundingClientRect(); const source = controller.sourceSize();
    const x = (event.clientX - overlayRect.left) * source.widthCssPixels / overlayRect.width;
    const y = (event.clientY - overlayRect.top) * source.heightCssPixels / overlayRect.height;
    const hits = entries.filter(({ bounds }) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
    const commit = (elementId: string) => {
      if (!reusablePickControl.value) return;
      if (reusablePickControl.value.multiple) for (const option of reusablePickControl.value.options)
        option.selected = option.selected || option.value === elementId;
      else reusablePickControl.value.value = elementId;
      reusablePickControl.value.dispatchEvent(new Event('change', { bubbles: true })); announceCueStatus('Canvas target selected.', false);
    };
    if (hits.length === 0) { announceCueStatus('No eligible object is under that point.', true); return; }
    if (hits.length === 1) { commit(hits[0]!.elementId); return; }
    const chooser = document.createElement('div'); chooser.className = 'cue-target-disambiguation'; chooser.dataset.cueTargetDisambiguation = '';
    Object.assign(chooser.style, { left: `${x}px`, top: `${y}px` });
    for (const hit of hits) { const choice = document.createElement('button'); choice.type = 'button'; choice.dataset.cueTargetChoice = '';
      choice.dataset.elementId = hit.elementId; choice.textContent = 'Choose object';
      choice.addEventListener('click', (choiceEvent) => { choiceEvent.stopPropagation(); commit(hit.elementId); }); chooser.append(choice); }
    cueTargetOverlay!.append(chooser);
  };
}

export function holdTargetOptions(enterMs: number): string {
  const attached = authoring.value.document.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
    && cue.semantic.kind === 'hold');
  const attachedIds = new Set(attached?.semantic.kind === 'hold' && attachedHoldSupportsBoundary(attached, enterMs)
    ? attached.semantic.targetIds : []);
  const eligibilityCueId = deriveCueId(authoring.value.document.documentId, 'editor-hold-target-eligibility');
  return authoring.value.document.elements.flatMap((element, index) => {
    const semantic: CueSemantic = { kind: 'hold', targetIds: [element.id], enterMs, durationMs: 1, exitMs: enterMs + 1 };
    return attachedIds.has(element.id) || projectCueReplacement(authoring.value.document, eligibilityCueId, semantic).ok
      ? [`<option value="${element.id}">Motion ${index + 1}</option>`] : [];
  }).join('');
}

export function attachedHoldSupportsBoundary(cue: AuthoringCue, enterMs: number): boolean {
  if (cue.semantic.kind !== 'hold' || !cue.replacement) return false;
  const contributingIds = new Set(cue.replacement.tracks.map((track) => track.elementId));
  if (cue.semantic.targetIds.some((targetId) => !contributingIds.has(targetId))) return false;
  return cue.replacement.tracks.every((sourceTrack) => {
    const application = cue.replacement!.applications.find((candidate) => candidate.slots.some((slot) => slot.id === sourceTrack.slotId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === sourceTrack.slotId) ?? -1;
    const slot = application?.slots[slotIndex];
    const binding = application?.bindings.find((candidate) => candidate.elementId === sourceTrack.elementId);
    const ruleTrack = cue.replacement!.rules.find((rule) => rule.id === sourceTrack.ruleId)?.tracks
      .find((track) => track.property === sourceTrack.property);
    return Boolean(slot && binding && ruleTrack?.keyframes.some((frame) =>
      binding.delayOverridesMs[slotIndex]! + frame.offset * slot.durationMs === enterMs));
  });
}

export function refreshHoldTargetOptions(form: HTMLFormElement): void {
  const target = form.elements.namedItem('target') as HTMLSelectElement;
  const attached = authoring.value.document.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
    && cue.semantic.kind === 'hold');
  const selected = new Set(attached?.semantic.kind === 'hold' ? attached.semantic.targetIds
    : [...target.selectedOptions].map((option) => option.value));
  const enterMs = Number((form.elements.namedItem('enter') as HTMLInputElement).value);
  target.innerHTML = `<option value="">Choose motion on canvas</option>${holdTargetOptions(enterMs)}`;
  for (const option of target.options) option.selected = selected.has(option.value);
  reusablePickControl.value = null; renderCueCanvas();
  if (attached?.semantic.kind === 'hold') {
    const retained = attached.semantic.targetIds.every((targetId) => [...target.selectedOptions]
      .some((option) => option.value === targetId));
    announceCueStatus(retained
      ? `Hold targets remain available at the explicit ${enterMs} ms boundary.`
      : `No complete Hold boundary exists at ${enterMs} ms. Existing Hold remains unchanged at revision ${authoring.value.document.revision}.`,
    !retained);
  }
}
