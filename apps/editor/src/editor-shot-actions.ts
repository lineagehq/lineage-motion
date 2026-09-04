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
import { submitCueForm, renderAuthoredCues, reconcileCueEditingProjection, hydrateCueForm, terminateCue, cueDiagnosticMessage, announceCueStatus, cueRoleLabel, cueRoleSelect, activateCueLayout, scheduleCueCanvas, renderCueCanvas, renderReusableTargetOverlay, holdTargetOptions, attachedHoldSupportsBoundary, refreshHoldTargetOptions } from './editor-cue-forms.js';
import { missingCueTarget, initializeCuePathDefaults, renderCueTargetOverlay, renderCuePathOverlay, cueVisualBounds, cuePathSegment, positionCuePathSegment, refreshCuePathSegments, beginCuePathDrag } from './editor-cue-canvas.js';
import { updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection } from './editor-timeline.js';
import { mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets } from './editor-preview.js';
import { openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar } from './editor-shot-workspace.js';
import { renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest } from './editor-shot-geometry.js';
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot } from './main.js';

export function shotStageProjection() {
  const { widthCssPixels, heightCssPixels } = controller.sourceSize();
  if (!Number.isSafeInteger(widthCssPixels) || widthCssPixels <= 0
    || !Number.isSafeInteger(heightCssPixels) || heightCssPixels <= 0) return null;
  const widthMicrounits = widthCssPixels * 1_000_000; const heightMicrounits = heightCssPixels * 1_000_000;
  if (!Number.isSafeInteger(widthMicrounits) || !Number.isSafeInteger(heightMicrounits)) return null;
  return { stageDigest: sha256Hex(`${compiled.value.exportDigest}\0${widthMicrounits}\0${heightMicrounits}`), widthMicrounits, heightMicrounits };
}

export function shotViewportIntent(): { widthCssPixels: number; heightCssPixels: number } | null {
  const { widthCssPixels, heightCssPixels } = controller.sourceSize();
  if (!Number.isSafeInteger(widthCssPixels) || widthCssPixels <= 0
    || !Number.isSafeInteger(heightCssPixels) || heightCssPixels <= 0) return null;
  return { widthCssPixels, heightCssPixels };
}

export function directPoseIntent(nextPose: ShotPose, kind: DirectPoseKind): OperationIntentPayload | null {
  if (!shotPrimaryElementId.value) return null;
  if (kind === 'move' && required<HTMLInputElement>('[data-move-together]').checked && shotSelection.value.length > 1) {
    const primary = projectTransformTrajectory(authoring.value.document, shotPrimaryElementId.value);
    const current = primary.eligible ? primary.waypoints.find((point) => point.timeMs === shotMomentMs.value) : null;
    const viewport = shotViewportIntent();
    if (!current || !viewport) return null;
    return { kind: 'motion.transform-waypoints.translate', elementIds: [...shotSelection.value], momentMs: shotMomentMs.value,
      deltaXPpm: Math.round((nextPose.translateXMicrounits - current.pose.translateXMicrounits) / viewport.widthCssPixels),
      deltaYPpm: Math.round((nextPose.translateYMicrounits - current.pose.translateYMicrounits) / viewport.heightCssPixels), viewport };
  }
  const viewport = shotViewportIntent(); if (!viewport) return null;
  return { kind: 'motion.transform-pose.set', elementId: shotPrimaryElementId.value, momentMs: shotMomentMs.value,
    pose: nextPose, viewport };
}

export type DirectPoseKind = 'move' | 'scale' | 'rotate';
export type ShotPose = { translateXMicrounits: number; translateYMicrounits: number; scalePpm: number; rotateMicrodegrees: number };

export function selectedShotPose(): { pose: ShotPose; target: { elementId: string; trackId: string; keyframeId: string; expectedTransform: string } } | null {
  if (!shotPrimaryElementId.value) return null;
  const selected = projectTrajectorySelection(authoring.value.document, [shotPrimaryElementId.value], shotMomentMs.value);
  const trajectory = projectTransformTrajectory(authoring.value.document, shotPrimaryElementId.value);
  if (!selected.eligible || !trajectory.eligible) return null;
  const waypoint = trajectory.waypoints.find((point) => point.timeMs === shotMomentMs.value);
  return waypoint ? { pose: { ...waypoint.pose }, target: selected.targets[0]! } : null;
}

export function normalizeRotation(degrees: number): number {
  if (degrees === 180 || degrees === -180) return degrees;
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

export function directPoseOperation(nextPose: ShotPose, kind: DirectPoseKind): AuthoringOperation | null {
  const selected = selectedShotPose(); const stage = shotStageProjection();
  if (!selected || !stage) return null;
  if (kind === 'move' && required<HTMLInputElement>('[data-move-together]').checked && shotSelection.value.length > 1) {
    return buildWaypointTranslateOperation(shotMomentMs.value, nextPose.translateXMicrounits, nextPose.translateYMicrounits);
  }
  return { ...operationEnvelope(), kind: 'motion.transform-pose.set', ...selected.target, payload: { pose: nextPose, stage } };
}

export function beginDirectPoseGesture(event: PointerEvent, kind: DirectPoseKind): void {
  if (event.button !== 0 || !shotPrimaryElementId.value || !alignShotPreviewToMoment(shotMomentMs.value)) return;
  const selected = selectedShotPose(); const projection = readShotProjection();
  if (!selected || !projection) return;
  event.preventDefault(); const surface = event.currentTarget as HTMLButtonElement;
  surface.setPointerCapture(event.pointerId);
  const start = { clientX: event.clientX, clientY: event.clientY }; const startPose = selected.pose;
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${shotPrimaryElementId.value}"]`);
  const targetRect = target?.getBoundingClientRect(); const iframeRect = iframe.getBoundingClientRect();
  const center = targetRect ? { x: iframeRect.left + (targetRect.left + targetRect.width / 2) * projection.scaleX,
    y: iframeRect.top + (targetRect.top + targetRect.height / 2) * projection.scaleY } : { x: start.clientX, y: start.clientY };
  const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
  const startRadius = Math.max(1, Math.hypot(event.clientX - center.x, event.clientY - center.y));
  const committedAtGestureStart = { html: compiled.value.html, css: compiled.value.css }; let latest: { operation: AuthoringOperation;
    intent: OperationIntentPayload; html: string; css: string } | null = null; let moved = false; let frame: number | null = null; let cancelled = false;
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
    const operation = directPoseOperation(pose, kind); const intent = directPoseIntent(pose, kind); if (!operation || !intent) return;
    const reduced = dispatchAuthoringOperation(authoring.value, operation); if (!reduced.ok) return;
    const draft = compileMotionDocument(reduced.state.document); latest = { operation, intent, html: draft.html, css: draft.css };
    if (frame === null) frame = requestAnimationFrame(preview);
    shotStatus.value = `${kind} draft · release to commit or press Escape to cancel.`;
  };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); if (frame !== null) cancelAnimationFrame(frame); };
  const cancel = () => { cancelled = true; cleanup(); latest = null; void controller.restoreCommittedCompilerCss().then(() => {
    shotStatus.value = `Draft cancelled · revision ${authoring.value.document.revision} unchanged.`; schedulePreviewSelection(); }); };
  const escape = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); cancel(); };
  const finish = () => { cleanup(); const draft = latest; if (!moved || !draft) { latest = null; return; }
    clearShotControlFeedback();
    void controller.applyCompilerCssDraft(draft.css).then(() => prepareAndDispatchIntent(draft.intent, undefined, undefined, {
      schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: committedAtGestureStart.html,
      oldCompilerCss: committedAtGestureStart.css, newCommittedHtml: draft.html, newCompilerCss: draft.css,
    })).then((result) => { shotStatus.value = result.ok ? `${kind} applied at revision ${authoring.value.document.revision}.` : `${result.code} · unchanged.`;
      if (!result.ok) showShotControlFailure('Pose', result.code);
      renderShotWorkspace(); }).catch(async () => { await controller.restoreCommittedCompilerCss(); }); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('keydown', escape);
}

export async function handleDirectPoseKeyboard(event: KeyboardEvent, kind: 'body' | 'scale' | 'rotate'): Promise<void> {
  const surface = event.currentTarget as HTMLElement;
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
  const intent = directPoseIntent(pose, operationKind); if (!intent) return;
  clearShotControlFeedback();
  const result = await prepareAndDispatchIntent(intent); shotStatus.value = result.ok ? `${operationKind} applied at revision ${authoring.value.document.revision}.` : `${result.code} · unchanged.`;
  if (!result.ok) showShotControlFailure('Pose', result.code);
  renderShotWorkspace(); surface.focus({ preventScroll: true });
}

export async function applyShotPose(): Promise<void> {
  if (!shotConfig.value || !shotPrimaryElementId.value) return; const primary = shotPrimaryElementId.value;
  clearShotControlFeedback();
  const selected = projectTrajectorySelection(authoring.value.document, [primary], shotMomentMs.value);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; showShotControlFailure('Pose', selected.code); return; }
  const controls = shotPoseForm.elements as unknown as Record<string, HTMLInputElement>;
  const nextPose = { translateXMicrounits: Math.round(Number(controls.x!.value) * 1_000_000),
    translateYMicrounits: Math.round(Number(controls.y!.value) * 1_000_000),
    scalePpm: Math.round(Number(controls.scale!.value) * 1_000_000),
    rotateMicrodegrees: Math.round(Number(controls.rotate!.value) * 1_000_000) };
  const intent = directPoseIntent(nextPose, 'move'); if (!intent) { shotStatus.value = 'TRAJECTORY_SELECTION_INVALID · unchanged.';
    showShotControlFailure('Pose', 'TRAJECTORY_SELECTION_INVALID'); return; }
  const result = await prepareAndDispatchIntent(intent); renderShotWorkspace();
  if (!result.ok) showShotControlFailure('Pose', result.code);
  shotStatus.value = result.ok ? `Pose applied at revision ${authoring.value.document.revision}.`
    : result.code === 'SERVICE_PREPARATION_FAILED' || result.code === 'PUBLICATION_FAILED'
      ? 'Pose could not be published. Your previous motion is still active.'
      : 'Pose could not be applied. Your previous motion is still active.';
}

export function buildWaypointTranslateOperation(momentMs: number, nextXMicrounits: number, nextYMicrounits: number): AuthoringOperation | null {
  const selected = projectTrajectorySelection(authoring.value.document, shotSelection.value, momentMs);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; return null; }
  const primary = projectTransformTrajectory(authoring.value.document, shotPrimaryElementId.value!);
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

export function beginWaypointDrag(event: PointerEvent, momentMs: number): void {
  if (event.button !== 0 || shotMode.value !== 'path' || !alignShotPreviewToMoment(momentMs)) return;
  shotMomentMs.value = momentMs; renderShotWorkspace();
  const primaryElementId = shotPrimaryElementId.value!;
  const primary = projectTransformTrajectory(authoring.value.document, primaryElementId); if (!primary.eligible) return;
  const current = primary.waypoints.find((point) => point.timeMs === momentMs); if (!current) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked && shotSelection.value.length > 1;
  const selected = projectTrajectorySelection(authoring.value.document, editTogether ? [...shotSelection.value] : [primaryElementId], momentMs);
  if (!selected.eligible) return;
  const stage = shotStageProjection(); if (!stage) return;
  const projection = readShotProjection(); if (!projection) return;
  const committedAtGestureStart = { html: compiled.value.html, css: compiled.value.css };
  const gestureGeneration = ++waypointGestureGeneration.value;
  waypointReleasePhase.value = 'idle';
  activeWaypointDraft.value = null; waypointDraftMoveCount.value = 0; waypointDraftAppliedCount.value = 0; waypointDraftFailure.value = null;
  if (waypointDraftFrame.value !== null) { cancelAnimationFrame(waypointDraftFrame.value); waypointDraftFrame.value = null; }
  const envelope = operationEnvelope();
  clearShotControlFeedback();
  event.preventDefault(); const surface = event.currentTarget as HTMLButtonElement; surface.setPointerCapture(event.pointerId);
  const feedbackHandle = surface.matches('[data-keyframe-id]') ? surface
    : shotOverlay.querySelector<HTMLElement>(`[data-element-id="${primaryElementId}"][data-time-ms="${momentMs}"]`);
  const start = { clientX: event.clientX, clientY: event.clientY }; let moved = false;
  const move = (next: PointerEvent) => {
    let deltaXPpm: number; let deltaYPpm: number;
    try { ({ deltaXPpm, deltaYPpm } = previewPointerDeltaToPpm(projection, start, { clientX: next.clientX, clientY: next.clientY })); }
    catch { shotStatus.value = `PREVIEW_POINTER_INVERSE_INVALID · revision ${authoring.value.document.revision} unchanged.`; return; }
    const candidate: AuthoringOperation = { ...envelope, kind: 'motion.transform-waypoints.translate', payload: {
      targets: selected.targets, deltaXPpm, deltaYPpm, stage } };
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1;
    if (moved) { surface.dataset.dragged = 'true'; if (feedbackHandle) feedbackHandle.style.translate = `${next.clientX - start.clientX}px ${next.clientY - start.clientY}px`;
      refreshTrajectorySegments(); }
    if (!moved || !Number.isSafeInteger(stage.widthMicrounits * deltaXPpm / 1_000_000)
      || !Number.isSafeInteger(stage.heightMicrounits * deltaYPpm / 1_000_000)) return;
    const reduced = dispatchAuthoringOperation(authoring.value, candidate); if (!reduced.ok) return;
    let draftCompiled;
    try { draftCompiled = compileMotionDocument(reduced.state.document); } catch { return; }
    const intent: OperationIntentPayload = { kind: 'motion.transform-waypoints.translate',
      elementIds: (editTogether ? [...shotSelection.value] : [primaryElementId]), momentMs, deltaXPpm, deltaYPpm,
      viewport: { widthCssPixels: projection.sourceWidthCssPixels, heightCssPixels: projection.sourceHeightCssPixels } };
    const nextDraft = { operation: candidate, intent, commandBytes: canonicalJson(makeTrajectoryCommand(candidate as Parameters<typeof makeTrajectoryCommand>[0], activeBranchId.value)),
      compiledHtml: draftCompiled.html, compiledCss: draftCompiled.css, exportDigest: draftCompiled.exportDigest };
    activeWaypointDraft.value = nextDraft; waypointDraftMoveCount.value += 1;
    if (waypointDraftFrame.value === null) waypointDraftFrame.value = requestAnimationFrame(() => {
      waypointDraftFrame.value = null; const frameDraft = activeWaypointDraft.value;
      waypointDraftApply.value = waypointDraftApply.value.then(async () => {
        if (!frameDraft || gestureGeneration !== waypointGestureGeneration.value || activeWaypointDraft.value !== frameDraft) return;
        await controller.applyCompilerCssDraft(frameDraft.compiledCss); waypointDraftAppliedCount.value += 1;
      }).catch(async (error: unknown) => {
        waypointDraftFailure.value = error instanceof Error ? error.message : 'PREVIEW_DRAFT_INVALID'; activeWaypointDraft.value = null;
        await controller.restoreCommittedCompilerCss();
        shotStatus.value = `${waypointDraftFailure.value} · revision ${authoring.value.document.revision} unchanged.`;
        showShotControlFailure('Position', waypointDraftFailure.value);
      });
    });
    shotStatus.value = `Trajectory draft · ${primaryElementId}/${current.keyframeId} · release to commit or press Escape to cancel.`;
  };
  const cancelDraftFrame = () => { if (waypointDraftFrame.value !== null) { cancelAnimationFrame(waypointDraftFrame.value); waypointDraftFrame.value = null; } };
  const clearTerminalFeedback = () => { if (feedbackHandle) feedbackHandle.style.translate = ''; refreshTrajectorySegments();
    queueMicrotask(() => { delete surface.dataset.dragged; }); };
  const detachGesture = (retainTerminalFeedback: boolean) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('keydown', cancelKeyboard);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (!retainTerminalFeedback) clearTerminalFeedback();
  };
  const restoreCommitted = () => { const cancelGeneration = ++waypointGestureGeneration.value; cancelDraftFrame(); activeWaypointDraft.value = null;
    void waypointDraftApply.value.then(async () => { if (cancelGeneration !== waypointGestureGeneration.value) return;
      await controller.restoreCommittedCompilerCss(); schedulePreviewSelection();
      waypointReleasePhase.value = 'idle'; shotStatus.value = `Draft cancelled · revision ${authoring.value.document.revision} unchanged.`; }); };
  const finish = () => { const releasedDraft = activeWaypointDraft.value; detachGesture(Boolean(moved && releasedDraft));
    const releaseGeneration = ++waypointGestureGeneration.value; cancelDraftFrame();
    if (moved && releasedDraft) {
      waypointReleasePhase.value = 'flushing-latest';
      waypointDraftApply.value = waypointDraftApply.value.then(async () => {
        if (releaseGeneration !== waypointGestureGeneration.value) return;
        await controller.applyCompilerCssDraft(releasedDraft.compiledCss); waypointDraftAppliedCount.value += 1;
      });
      void waypointDraftApply.value.then(async () => {
        if (releaseGeneration !== waypointGestureGeneration.value || waypointDraftFailure.value) return;
        waypointReleasePhase.value = 'committing';
        const result = await prepareAndDispatchIntent(releasedDraft.intent, undefined, undefined, {
          schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: committedAtGestureStart.html,
          oldCompilerCss: committedAtGestureStart.css, newCommittedHtml: releasedDraft.compiledHtml,
          newCompilerCss: releasedDraft.compiledCss,
        });
        if (!result.ok) {
          await controller.restoreCommittedCompilerCss();
          showShotControlFailure('Position', result.code);
        }
        else { waypointReleasePhase.value = 'publishing-geometry'; await awaitShotGeometryCommit(); }
      }).catch(async (error: unknown) => {
        waypointDraftFailure.value = error instanceof Error ? error.message : 'PREVIEW_DRAFT_INVALID';
        await controller.restoreCommittedCompilerCss();
        shotStatus.value = `${waypointDraftFailure.value} · revision ${authoring.value.document.revision} unchanged.`;
        showShotControlFailure('Position', waypointDraftFailure.value);
      }).finally(() => { if (releaseGeneration === waypointGestureGeneration.value) activeWaypointDraft.value = null;
        waypointReleasePhase.value = 'idle'; clearTerminalFeedback(); });
    } else if (moved) { restoreCommitted(); }
    else { waypointReleasePhase.value = 'idle'; activeWaypointDraft.value = null; }
  };
  const cancelPointer = () => { detachGesture(false); restoreCommitted(); };
  const cancelKeyboard = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); detachGesture(false); restoreCommitted(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', cancelPointer, { once: true }); window.addEventListener('keydown', cancelKeyboard);
}

export async function addShotMoment(beforeMs: number, afterMs: number): Promise<void> {
  if (!shotConfig.value || !shotPrimaryElementId.value) return;
  clearShotControlFeedback();
  const timeMs = Math.floor((beforeMs + afterMs) / 2);
  if (!(beforeMs < timeMs && timeMs < afterMs)) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const intent: OperationIntentPayload = { kind: 'motion.transform-waypoint.add',
    elementIds: editTogether ? [...shotConfig.value.targetElementIds] : [shotPrimaryElementId.value], timeMs };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { shotMomentMs.value = timeMs; alignShotPreviewToMoment(timeMs); }
  shotStatus.value = result.ok ? `Point added at ${timeMs} ms · revision ${authoring.value.document.revision}.`
    : `${result.code} · no point added.`;
  if (!result.ok) showShotControlFailure('Point', result.code);
  if (result.ok) { renderShotWorkspace(); focusShotMoment(timeMs); }
}

export async function removeShotMoment(): Promise<void> {
  if (!shotConfig.value || !shotPrimaryElementId.value || shotMomentMs.value === shotConfig.value.startMs || shotMomentMs.value === shotConfig.value.settledMs) return;
  clearShotControlFeedback();
  const inventory = canonicalShotInventory()?.find((candidate) => candidate.elementId === shotPrimaryElementId.value);
  const previous = inventory?.waypoints.filter((point) => point.timeMs < shotMomentMs.value).at(-1)?.timeMs ?? shotConfig.value.startMs;
  const removing = shotMomentMs.value;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const intent: OperationIntentPayload = { kind: 'motion.transform-waypoint.remove',
    elementIds: editTogether ? [...shotConfig.value.targetElementIds] : [shotPrimaryElementId.value], timeMs: removing };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { shotMomentMs.value = previous; alignShotPreviewToMoment(previous); }
  shotStatus.value = result.ok ? `Point removed · revision ${authoring.value.document.revision}.` : `${result.code} · unchanged.`;
  if (!result.ok) showShotControlFailure('Point', result.code);
  renderShotWorkspace();
  if (result.ok) focusShotMoment(previous);
}

export async function applyShotMomentTime(targetTimeMs: number): Promise<void> {
  const config = shotConfig.value;
  if (!config || shotMomentMs.value === config.startMs || shotMomentMs.value === config.settledMs
    || !Number.isSafeInteger(targetTimeMs) || targetTimeMs === shotMomentMs.value) return;
  const sourceTimeMs = shotMomentMs.value;
  clearShotControlFeedback();
  alignShotPreviewToMoment(sourceTimeMs);
  renderShotWorkspace();
  const inventory = canonicalShotInventory()?.find((candidate) => candidate.elementId === shotPrimaryElementId.value);
  const intermediate = inventory?.waypoints.map((point) => point.timeMs)
    .filter((timeMs) => timeMs > config.startMs && timeMs < config.settledMs) ?? [];
  const landingTimeMs = Math.min(targetTimeMs, ...intermediate.filter((timeMs) => timeMs !== sourceTimeMs));
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const intent: OperationIntentPayload = { kind: 'motion.keyframe-group-time.set',
    elementIds: editTogether ? [...config.targetElementIds] : shotPrimaryElementId.value ? [shotPrimaryElementId.value] : [],
    sourceTimeMs, targetTimeMs, landingTimeMs, settledTimeMs: config.settledMs };
  const result = await prepareAndDispatchIntent(intent);
  if (result.ok) { shotMomentMs.value = targetTimeMs; alignShotPreviewToMoment(targetTimeMs); }
  else { shotMomentMs.value = sourceTimeMs; alignShotPreviewToMoment(sourceTimeMs); showShotControlFailure('Timing', result.code); }
  shotStatus.value = result.ok ? `Point moved to ${targetTimeMs} ms · revision ${authoring.value.document.revision}.`
    : `${result.code} · timing unchanged.`;
  renderShotWorkspace();
}

export function effectiveShotTimings(targets: Array<{ trackId: string; elementId: string; keyframeId: string; expectedTransform: string }>): Array<TimingFunction> | null {
  const effectiveTimings = targets.map((target): TimingFunction | null => {
    const track = authoring.value.document.tracks.find((item) => item.id === target.trackId && item.elementId === target.elementId && item.property === 'transform');
    const rule = track && authoring.value.document.rules.find((item) => item.id === track.ruleId);
    const ruleTrack = rule?.tracks.find((item) => item.property === 'transform');
    const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId && item.value === target.expectedTransform);
    const application = track && authoring.value.document.applications.find((item) => item.slots.some((slot) => slot.id === track.slotId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === track?.slotId) ?? -1;
    const slot = application?.slots[slotIndex];
    const binding = application?.bindings.find((item) => item.elementId === target.elementId);
    if (!track || !ruleTrack || !keyframe || !application || !slot || binding?.delayOverridesMs[slotIndex] === undefined) return null;
    return keyframe.easing ?? slot.timingFunction;
  });
  return effectiveTimings.some((timing) => timing === null) ? null : effectiveTimings as Array<TimingFunction>;
}

export async function applyShotEasing(): Promise<void> {
  if (!shotConfig.value || shotMomentMs.value === shotConfig.value.settledMs) return;
  clearShotControlFeedback();
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const elementIds = editTogether ? shotConfig.value.targetElementIds : shotPrimaryElementId.value ? [shotPrimaryElementId.value] : [];
  const selected = projectTrajectorySelection(authoring.value.document, elementIds, shotMomentMs.value);
  if (!selected.eligible) { shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; showShotControlFailure('Movement', selected.code); return; }
  const effectiveTimings = effectiveShotTimings(selected.targets);
  if (!effectiveTimings) { shotStatus.value = 'AUTHORING_TRAJECTORY_EASING_MISSING · unchanged.';
    showShotControlFailure('Movement', 'AUTHORING_TRAJECTORY_EASING_MISSING'); return; }
  const expectedEasing = effectiveTimings[0]!;
  if (effectiveTimings.some((timing) => canonicalJson(timing) !== canonicalJson(expectedEasing))) {
    shotStatus.value = 'AUTHORING_TRAJECTORY_EASING_NON_UNIFORM · unchanged.';
    showShotControlFailure('Movement', 'AUTHORING_TRAJECTORY_EASING_NON_UNIFORM'); return;
  }
  const draft = required<HTMLSelectElement>('[data-shot-easing]').value;
  if (draft === 'custom') { shotStatus.value = 'Choose an easing preset to replace the source curve.';
    showShotControlFailure('Movement', 'AUTHORING_TRAJECTORY_EASING_CUSTOM'); return; }
  const value = draft as 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
  const intent: OperationIntentPayload = { kind: 'motion.keyframe-group-easing.set', elementIds: [...elementIds],
    momentMs: shotMomentMs.value, expectedEasing, easing: { kind: 'keyword', value } };
  const result = await prepareAndDispatchIntent(intent);
  if (!result.ok) showShotControlFailure('Movement', result.code);
  shotStatus.value = result.ok ? `Movement after ${shotMomentLabel(shotMomentMs.value)} updated · revision ${authoring.value.document.revision}.`
    : `${result.code} · unchanged.`; renderShotWorkspace();
}

export async function applyShotHold(): Promise<void> {
  const config = shotConfig.value;
  if (!config) return;
  clearShotControlFeedback();
  const settledInput = required<HTMLInputElement>('[data-shot-settled]');
  const settled = Number(settledInput.value);
  if (!Number.isSafeInteger(settled) || settled <= 1 || settled >= config.settledMs) {
    settledInput.setAttribute('aria-invalid', 'true'); settledInput.focus();
    shotStatus.value = `Hold must begin between 2 and ${config.settledMs - 1} ms · unchanged.`;
    showShotControlFailure('Hold', 'AUTHORING_TRAJECTORY_HOLD_INVALID'); return;
  }
  const inventory = canonicalShotInventory()?.[0];
  const landing = inventory?.waypoints.map((point) => point.timeMs)
    .filter((timeMs) => timeMs > config.startMs && timeMs < settled).at(-1) ?? config.landedMs;
  const selected = projectTrajectorySelection(authoring.value.document, config.targetElementIds, 2100); if (!selected.eligible) {
    shotStatus.value = selected.code ?? 'TRAJECTORY_SELECTION_INVALID'; showShotControlFailure('Hold', selected.code); return; }
  const intent: OperationIntentPayload = { kind: 'motion.settled-hold.set', elementIds: [...config.targetElementIds],
    sourceTimeMs: 2100, settledTimeMs: settled, landingTimeMs: landing, boundaryTimeMs: 2100 };
  const result = await prepareAndDispatchIntent(intent);
  if (!result.ok) showShotControlFailure('Hold', result.code);
  shotStatus.value = result.ok ? `Settled hold applied at revision ${authoring.value.document.revision}.` : `${result.code} · unchanged.`; renderShotWorkspace();
}
