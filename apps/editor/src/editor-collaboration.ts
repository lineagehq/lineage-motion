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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, captureDraft, restoreDraft, resolveDraftConflict, dirtyStaleBase, resolveAcceptedCreationDraft, resolveAcceptedOperationDraft, operationEnvelope, withCreatedTrack, makeEdit, makeHistory, nextOperationId, renderProjection, submitCueForm, renderAuthoredCues, reconcileCueEditingProjection, hydrateCueForm, terminateCue, cueDiagnosticMessage, announceCueStatus, cueRoleLabel, cueRoleSelect, activateCueLayout, scheduleCueCanvas, renderCueCanvas, renderReusableTargetOverlay, holdTargetOptions, attachedHoldSupportsBoundary, refreshHoldTargetOptions, missingCueTarget, initializeCuePathDefaults, renderCueTargetOverlay, renderCuePathOverlay, cueVisualBounds, cuePathSegment, positionCuePathSegment, refreshCuePathSegments, beginCuePathDrag, updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection, mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export async function reconcileCommit(event: CommitMetadata, subscriptionGeneration: number): Promise<void> {
  if (!serviceClient || subscriptionGeneration !== eventSubscriptionGeneration.value || event.commitSeq <= lastCommitSeq.value) return;
  const acknowledge = () => { lastCommitSeq.value = event.commitSeq; lastCommit.value = event; reconciliationFailures.delete(event.commitSeq); };
  const gap = event.commitSeq !== lastCommitSeq.value + 1;
  if (event.branchId !== activeBranchId.value) { acknowledge(); await refreshDurableContext(); return; }
  if (event.kind === 'motion.track.create' && event.revision < authoring.value.document.revision) { acknowledge(); return; }
  const branchAtStart = branchGeneration.value;
  const immutable = gap ? await serviceClient!.head(event.documentId, event.branchId)
    : await serviceClient!.revision(event.documentId, event.revision);
  if (branchAtStart !== branchGeneration.value || event.branchId !== activeBranchId.value) return;
  if (!gap && immutable.canonicalDigest !== event.digest) throw new Error('REMOTE_DIGEST_MISMATCH');
  if (gap && immutable.document.revision === event.revision && immutable.canonicalDigest !== event.digest)
    throw new Error('REMOTE_GAP_DIGEST_MISMATCH');
  const applied = immutable.document.revision !== authoring.value.document.revision;
  if (applied) await applyImmutable(immutable, true);
  acknowledge();
  if (applied || gap) {
    status.value = gap ? `Event gap detected; immutable branch head refetched at revision ${authoring.value.document.revision}.`
      : `Revision ${authoring.value.document.revision} refreshed from committed service state.`;
    status.dataset.kind = 'success';
  }
  if (!applied) await refreshDurableContext();
}

export async function switchBranch(branchId: string): Promise<void> {
  if (!serviceClient) return; const generation = ++branchGeneration.value;
  reconciliation.value = reconciliation.value.then(async () => {
    const immutable = await serviceClient!.head(authoring.value.document.documentId, branchId);
    if (generation !== branchGeneration.value) return;
    activeBranchId.value = branchId; await applyImmutable(immutable, true);
    status.value = `Branch ${branchId} head revision ${authoring.value.document.revision} loaded.`;
  });
  await reconciliation.value;
}

export async function createBranch(branchId: string): Promise<void> {
  if (!serviceClient) return;
  if (rejectUnavailablePublication()) return;
  try {
    const response = await serializeServiceCommand(() => serviceClient!.dispatch(makeBranchCreateCommand({ operationId: nextOperationId(),
      documentId: authoring.value.document.documentId, sourceBranchId: activeBranchId.value,
      expectedRevision: authoring.value.document.revision, branchId })));
    if (!response) return;
    if (!response.ok) { publishServiceDiagnostic(response.diagnostic); return; }
    if (branchSelect && ![...branchSelect.options].some((option) => option.value === branchId)) branchSelect.add(new Option(branchId, branchId));
    if (branchSelect) branchSelect.value = branchId; await switchBranch(branchId); status.dataset.kind = 'success';
  } catch { publishClientDiagnostic('SERVICE_UNAVAILABLE', 'storage', true); }
}

export async function revokeClaim(claimId: string, leaseVersion: number): Promise<void> {
  if (!serviceClient) return;
  if (rejectUnavailablePublication()) return;
  try {
    const documentRevision = await serviceClient!.documentRevision(authoring.value.document.documentId);
    const response = await serializeServiceCommand(() => serviceClient!.dispatch(makeClaimControlCommand({ kind: 'motion.claim.revoke', operationId: nextOperationId(),
      documentId: authoring.value.document.documentId, branchId: activeBranchId.value, expectedRevision: documentRevision.revision,
      claimId, leaseVersion })));
    if (!response) return;
    if (!response.ok) { publishServiceDiagnostic(response.diagnostic); return; }
    status.value = `Claim ${response.claimId} revoked at lease version ${response.leaseVersion}.`; status.dataset.kind = 'success';
    await refreshDurableContext();
  } catch { publishClientDiagnostic('SERVICE_UNAVAILABLE', 'storage', true); }
}

export async function serializeServiceCommand<T>(command: () => Promise<T>): Promise<T | null> {
  const task = reconciliation.value.then(() => rejectUnavailablePublication() ? null : command());
  reconciliation.value = task.then(() => undefined, () => undefined); return task;
}

export function clearKeyframeSelection(): void {
  selectedTrackId.value = null;
  selectedKeyframeId.value = null;
  hasExplicitKeyframeSelection.value = false;
}

export type ImmutableHead = Awaited<ReturnType<MotionServiceClient['head']>>;
export async function applyImmutable(immutable: ImmutableHead, remote: boolean, previewPromotion?: PreviewCssCommitPromotion): Promise<void> {
  const draft = captureDraft();
  const nextAuthoring = createAuthoringState(immutable.document); const nextCompiled = compileMotionDocument(nextAuthoring.document);
  const previousCompiled = compiled.value;
  setPublicationState('pending');
  let promoted = false;
  try {
    const nextDurableContext = serviceClient
      ? await fetchDurableContext(nextAuthoring.document.documentId, activeBranchId.value)
      : null;
    if (publicationTestGate.value) await publicationTestGate.value.promise;
    if (previewPromotion) {
      try {
        await controller.promoteCompilerCssCommit({ ...previewPromotion, newCommittedHtml: nextCompiled.html, newCompilerCss: nextCompiled.css });
        promoted = true; lastPreviewCommitPromotion.value = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
          promoted: true, fallbackCode: null };
      } catch (error) {
        lastPreviewCommitPromotion.value = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true, promoted: false,
          fallbackCode: error instanceof Error ? error.message : 'PREVIEW_CSS_COMMIT_PROMOTION_INVALID' };
      }
    } else {
      lastPreviewCommitPromotion.value = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: false,
        promoted: false, fallbackCode: null };
    }
    if (!promoted) await mountPreview(nextCompiled.html, nextCompiled.css);
    if (failNextPublicationForTest.value) {
      failNextPublicationForTest.value = false;
      throw new Error('PREVIEW_PUBLICATION_TEST_FAILURE');
    }
    authoring.value = nextAuthoring; compiled.value = nextCompiled; immutableRefetchCount.value += 1;
    if (nextDurableContext) publishDurableContext(nextDurableContext);
    renderProjection();
    if (shotConfig.value) renderShotWorkspace();
    if (draft.dirty) {
      restoreDraft(draft);
      if (remote) { draftConflictRevision.value = authoring.value.document.revision;
        draftConflict.hidden = false; draftConflict.dataset.revision = String(draftConflictRevision.value); }
    } else {
      draftStaleBaseRevision.value = null;
    }
    setPublicationState('settled');
  } catch (error) {
    compiled.value = previousCompiled;
    try { await mountPreview(previousCompiled.html, previousCompiled.css); } catch { /* preserve explicit failed state */ }
    setPublicationState('failed', error instanceof Error ? error.message : 'PUBLICATION_FAILED');
    publishClientDiagnostic('PUBLICATION_FAILED', 'storage', true);
    throw error;
  }
}
