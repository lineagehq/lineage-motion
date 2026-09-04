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
import { editorShellMarkup } from './editor-shell.js';
import { rejectUnavailablePublication, dispatch, serviceCommandForOperation, prepareAndDispatchIntent, durableUndoAvailable, durableRedoAvailable, findCommittedOperation, fetchDurableContext, publishDurableContext, refreshDurableContext } from './editor-dispatch.js';
import { setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic } from './editor-feedback.js';
import type { ShotControlAction } from './editor-feedback.js';
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
import { shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold } from './editor-shot-actions.js';
import type { DirectPoseKind, ShotPose } from './editor-shot-actions.js';
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, DraftSnapshot } from './main.js';

export function renderProjection(): void {
  const timeline = buildTimeline(authoring.value.document);
  const timelineElement = required<HTMLElement>('[data-timeline]');
  timelineElement.dataset.durationMs = String(timeline.durationMs);
  scrubber.max = String(shotConfig.value ? shotConfig.value.settledMs + 1 : timeline.durationMs);
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
  if (payload.cueWorkspace) renderAuthoredCues();
  const hold = timeline.holds?.[0];
  insertHoldButton.disabled = Boolean(hold);
  holdStatus.value = hold
    ? `600 ms hold inserted · Pair crosses at ${hold.sourceTimeMs + hold.durationMs} ms · duration ${timeline.durationMs} ms`
    : 'No hold inserted · Pair crosses at 2870 ms';
  required<HTMLElement>('[data-hold-control]').dataset.active = String(Boolean(hold));
  for (const [button, unavailable] of [[undoButton, serviceClient ? !durableUndoAvailable() : authoring.value.undo.length === 0],
    [redoButton, serviceClient ? !durableRedoAvailable() : authoring.value.redo.length === 0]] as const) {
    button.removeAttribute('aria-disabled');
    button.disabled = unavailable;
  }
  if (cueWorkspace) required<HTMLElement>('[data-cue-history-slot]').hidden = undoButton.disabled && redoButton.disabled;
  updateStructuralControls(timeline.rows);
  updateSelection();
  scheduleCueCanvas();
}
