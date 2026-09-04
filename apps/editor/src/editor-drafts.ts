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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, submitCueForm, renderAuthoredCues, reconcileCueEditingProjection, hydrateCueForm, terminateCue, cueDiagnosticMessage, announceCueStatus, cueRoleLabel, cueRoleSelect, activateCueLayout, scheduleCueCanvas, renderCueCanvas, renderReusableTargetOverlay, holdTargetOptions, attachedHoldSupportsBoundary, refreshHoldTargetOptions, missingCueTarget, initializeCuePathDefaults, renderCueTargetOverlay, renderCuePathOverlay, cueVisualBounds, cuePathSegment, positionCuePathSegment, refreshCuePathSegments, beginCuePathDrag, updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection, mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export function captureDraft(): DraftSnapshot {
  const values: Record<string, string> = {}; const dirtyFields: Record<string, boolean> = {};
  for (const selector of ['[data-duration]', '[data-delay]', '[data-easing]', '[data-value]', '[data-time]',
    '[data-new-branch]', '[data-claim-id]', '[data-lease-version]']) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (!control) continue;
    values[selector] = control.value;
    dirtyFields[selector] = selector === '[data-duration]' || selector === '[data-delay]' || selector === '[data-easing]'
      ? control.closest<HTMLElement>('.timing-control')?.dataset.draft === 'true' : control.dataset.draft === 'true';
  }
  const dirty = Object.values(dirtyFields).some(Boolean) || creationDraftDirty.value;
  return { dirty, values, dirtyFields, creationElementId: selectedCreationElementId.value, creationDirty: creationDraftDirty.value,
    staleBaseRevision: dirtyStaleBase(dirty) };
}
export function restoreDraft(draft: DraftSnapshot): void {
  for (const [selector, value] of Object.entries(draft.values)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (control && draft.dirtyFields[selector]) control.value = value;
  }
  selectedCreationElementId.value = draft.creationElementId;
  creationDraftDirty.value = draft.creationDirty; draftStaleBaseRevision.value = draft.staleBaseRevision;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]'))
    radio.checked = radio.value === selectedCreationElementId.value;
  for (const [selector, dirty] of Object.entries(draft.dirtyFields)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector); if (!control) continue;
    if (selector === '[data-duration]' || selector === '[data-delay]' || selector === '[data-easing]') {
      control.closest<HTMLElement>('.timing-control')!.dataset.draft = String(dirty);
      required<HTMLElement>('em', control.closest('.timing-control')!).hidden = !dirty;
    } else control.dataset.draft = String(dirty);
  }
}
export function resolveDraftConflict(keep: boolean): void {
  if (!keep) {
    selectedCreationElementId.value = null; creationDraftDirty.value = false; draftStaleBaseRevision.value = null;
    valueInput.value = ''; timeInput.value = ''; valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) radio.checked = false;
    for (const control of document.querySelectorAll<HTMLInputElement>('[data-new-branch], [data-claim-id], [data-lease-version]')) {
      control.value = control.defaultValue; control.dataset.draft = 'false';
    }
    renderProjection();
  }
  draftConflictRevision.value = null; draftConflict.hidden = true;
  status.value = keep ? `Local draft kept against revision ${authoring.value.document.revision}; apply it explicitly when ready.`
    : `Local draft discarded; revision ${authoring.value.document.revision} values restored.`;
  status.dataset.kind = 'success';
}

export function dirtyStaleBase(dirty: boolean): number | null {
  return dirty ? draftStaleBaseRevision.value ?? authoring.value.document.revision : null;
}

export function resolveAcceptedCreationDraft(): void {
  creationDraftDirty.value = false;
  if (captureDraft().dirty) return;
  draftStaleBaseRevision.value = null;
  draftConflictRevision.value = null;
  draftConflict.hidden = true;
  delete draftConflict.dataset.revision;
}

export function resolveAcceptedOperationDraft(operation: Pick<EditorPersistentOperation, 'kind'>): void {
  if (operation.kind === 'motion.track.create') resolveAcceptedCreationDraft();
  const timingControl = operation.kind === 'motion.slot-duration.set' ? durationInput
    : operation.kind === 'motion.binding-delay.set' ? delayInput
      : operation.kind === 'motion.slot-easing.set' ? easingInput : null;
  if (timingControl) {
    const container = timingControl.closest<HTMLElement>('.timing-control')!;
    container.dataset.draft = 'false'; required<HTMLElement>('em', container).hidden = true;
    timingControl.setAttribute('aria-invalid', 'false');
  }
  if (operation.kind === 'motion.keyframe-value.set') valueInput.dataset.draft = 'false';
  if (operation.kind === 'motion.keyframe-time.set') timeInput.dataset.draft = 'false';
  if (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo') {
    for (const control of [durationInput, delayInput, easingInput]) {
      const container = control.closest<HTMLElement>('.timing-control')!;
      container.dataset.draft = 'false'; required<HTMLElement>('em', container).hidden = true;
      control.setAttribute('aria-invalid', 'false');
    }
    valueInput.dataset.draft = 'false'; timeInput.dataset.draft = 'false';
    valueInput.setAttribute('aria-invalid', 'false'); timeInput.setAttribute('aria-invalid', 'false');
  }
}

export function operationEnvelope() {
  return { schemaVersion: 'motion.operation.v1' as const, operationId: nextOperationId(),
    documentId: authoring.value.document.documentId, expectedRevision: authoring.value.document.revision };
}

export async function withCreatedTrack(
  create: (track: TimelineRow) => AuthoringOperation,
  focusSelector?: string | (() => string),
): Promise<{ ok: boolean; code?: string }> {
  const track = findCreatedTrack(buildTimeline(authoring.value.document).rows);
  if (!track) {
    status.value = `AUTHORING_TRACK_NOT_FOUND: operation rejected; revision ${authoring.value.document.revision} unchanged.`;
    status.dataset.kind = 'error'; return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  }
  return dispatch(create(track), typeof focusSelector === 'function' ? focusSelector() : focusSelector);
}

export function makeEdit(
  kind: 'motion.keyframe-value.set' | 'motion.keyframe-time.set',
  payload: { value: number } | { timeMs: number },
): AuthoringOperation {
  const target = currentTarget();
  return {
    schemaVersion: 'motion.operation.v1', operationId: nextOperationId(),
    documentId: authoring.value.document.documentId, expectedRevision: authoring.value.document.revision,
    kind, elementId: target.elementId, trackId: target.trackId, keyframeId: selectedKeyframeId.value,
    payload,
  } as AuthoringOperation;
}

export function makeHistory(kind: 'motion.history.undo' | 'motion.history.redo'): AuthoringOperation {
  return {
    schemaVersion: 'motion.operation.v1', operationId: nextOperationId(),
    documentId: authoring.value.document.documentId, expectedRevision: authoring.value.document.revision, kind,
  };
}

export function nextOperationId(): string {
  operationSequence.value += 1;
  return `editor:${operationClientId}:${operationSequence.value}`;
}
