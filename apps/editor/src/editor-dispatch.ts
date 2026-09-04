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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, connectEvents, reconcileCommit, switchBranch, createBranch, revokeClaim, serializeServiceCommand, clearKeyframeSelection, applyImmutable, captureDraft, restoreDraft, resolveDraftConflict, dirtyStaleBase, resolveAcceptedCreationDraft, resolveAcceptedOperationDraft, operationEnvelope, withCreatedTrack, makeEdit, makeHistory, nextOperationId, renderProjection, submitCueForm, renderAuthoredCues, reconcileCueEditingProjection, hydrateCueForm, terminateCue, cueDiagnosticMessage, announceCueStatus, cueRoleLabel, cueRoleSelect, activateCueLayout, scheduleCueCanvas, renderCueCanvas, renderReusableTargetOverlay, holdTargetOptions, attachedHoldSupportsBoundary, refreshHoldTargetOptions, missingCueTarget, initializeCuePathDefaults, renderCueTargetOverlay, renderCuePathOverlay, cueVisualBounds, cuePathSegment, positionCuePathSegment, refreshCuePathSegments, beginCuePathDrag, updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection, mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, ImmutableHead, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export function rejectUnavailablePublication(): 'PUBLICATION_PENDING' | 'PUBLICATION_FAILED' | null {
  if (publicationState.value === 'settled') return null;
  const code = publicationState.value === 'pending' ? 'PUBLICATION_PENDING' : 'PUBLICATION_FAILED';
  publishClientDiagnostic(code, 'storage', true);
  return code;
}

export async function dispatch(
  operation: EditorPersistentOperation,
  focusSelector?: string,
  historyAnchor?: { viewportTop: number; scrollY: number },
  previewPromotion?: PreviewCssCommitPromotion,
): Promise<{ ok: boolean; code?: string }> {
  const publicationRejection = rejectUnavailablePublication();
  if (publicationRejection) return { ok: false, code: publicationRejection };
  const beforeCreated = findCreatedTrack(buildTimeline(authoring.value.document).rows);
  let authoritativePreviewAlreadyMounted = false;
  let result: ReturnType<typeof dispatchAuthoringOperation>;
  if (serviceClient) {
    const command = serviceCommandForOperation(operation);
    const commandTask = reconciliation.value.then(async () => {
      const queuedPublicationRejection = rejectUnavailablePublication();
      if (queuedPublicationRejection) return { response: null, applied: false,
        authoritativePreviewAlreadyMounted: false, publicationRejection: queuedPublicationRejection };
      let response;
      try { response = await serviceClient!.dispatch(command); }
      catch {
        try { response = await serviceClient!.dispatch(command); }
        catch {
          const operationDigest = sha256Hex(canonicalJson(command));
          try {
            const committed = await findCommittedOperation(operation.documentId, operationDigest);
            if (!committed) return { response: null, applied: false, authoritativePreviewAlreadyMounted: false };
            pendingRevision.value = committed.revision;
            const immutable = await serviceClient!.revision(operation.documentId, committed.revision);
            resolveAcceptedOperationDraft(operation);
            await applyImmutable(immutable, false, previewPromotion);
            resolveAcceptedCreationDraft(); pendingRevision.value = null;
            return { response: null, applied: true, authoritativePreviewAlreadyMounted: true };
          } catch { pendingRevision.value = null;
            return { response: null, applied: false, authoritativePreviewAlreadyMounted: false }; }
        }
      }
      if (response.ok) {
        pendingRevision.value = response.resultingRevision;
        try {
          const immutable = await serviceClient!.revision(response.documentId, response.resultingRevision);
          resolveAcceptedOperationDraft(operation);
          await applyImmutable(immutable, false, previewPromotion);
          resolveAcceptedCreationDraft();
        }
        finally { pendingRevision.value = null; }
        return { response, applied: true, authoritativePreviewAlreadyMounted: true };
      }
      pendingRevision.value = null;
      if (response.code === 'STALE_REVISION') {
        const immutable = await serviceClient!.head(operation.documentId, activeBranchId.value);
        await applyImmutable(immutable, true);
      }
      return { response, applied: false, authoritativePreviewAlreadyMounted: false };
    });
    reconciliation.value = commandTask.then(() => undefined, () => undefined);
    const outcome = await commandTask; const response = outcome.response;
    if ('publicationRejection' in outcome && outcome.publicationRejection) {
      return { ok: false, code: outcome.publicationRejection };
    }
    if (!response && !outcome.applied) {
      publishClientDiagnostic('SERVICE_UNAVAILABLE', 'storage', true);
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
    if (response && !response.ok && !outcome.applied) {
      publishServiceDiagnostic(response.diagnostic);
      return { ok: false, code: response.diagnostic.code };
    } else {
      result = { ok: true, state: authoring.value };
      authoritativePreviewAlreadyMounted = outcome.authoritativePreviewAlreadyMounted;
    }
  } else {
    publishClientDiagnostic('SERVICE_REQUIRED', 'protocol', false);
    return { ok: false, code: 'SERVICE_REQUIRED' };
  }
  authoring.value = result.state;
  if (!authoritativePreviewAlreadyMounted) {
    compiled.value = compileMotionDocument(authoring.value.document);
    let promoted = false;
    if (previewPromotion) {
      try {
        await controller.promoteCompilerCssCommit({ ...previewPromotion,
          newCommittedHtml: compiled.value.html, newCompilerCss: compiled.value.css });
        promoted = true; lastPreviewCommitPromotion.value = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
          promoted: true, fallbackCode: null };
      } catch (error) {
        lastPreviewCommitPromotion.value = { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true,
          promoted: false, fallbackCode: error instanceof Error ? error.message : 'PREVIEW_CSS_COMMIT_PROMOTION_INVALID' };
      }
    }
    if (!promoted) await mountPreview(compiled.value.html, compiled.value.css);
  }
  const rows = buildTimeline(authoring.value.document).rows;
  const created = findCreatedTrack(rows);
  const createdKeyframeCount = created?.keyframes.length ?? 0;
  if (created) {
    selectedTrackId.value = created.trackId;
    if (operation.kind === 'motion.keyframe.add') {
      selectedKeyframeId.value = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
      hasExplicitKeyframeSelection.value = true;
    } else if (operation.kind === 'motion.keyframe.remove') {
      selectedKeyframeId.value = created.keyframes.at(-1)!.id;
    } else if (operation.kind === 'motion.track.create'
      || !created.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId.value)) {
      selectedKeyframeId.value = created.keyframes[0]!.id;
    }
  } else {
    const selectedStillExists = selectedTrackId.value && selectedKeyframeId.value
      && rows.find((row) => row.trackId === selectedTrackId.value)
        ?.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId.value);
    if (!selectedStillExists) {
      selectedTrackId.value = null;
      selectedKeyframeId.value = null;
    }
  }
  if (operation.kind === 'motion.history.undo'
    && (!created || createdKeyframeCount === 2)) {
    clearKeyframeSelection();
  } else if (operation.kind === 'motion.history.redo' && !beforeCreated && created) {
    selectedTrackId.value = created.trackId;
    selectedKeyframeId.value = created.keyframes[0]!.id;
    hasExplicitKeyframeSelection.value = true;
  } else if (operation.kind === 'motion.history.redo' && createdKeyframeCount === 3 && created) {
    selectedTrackId.value = created.trackId;
    selectedKeyframeId.value = created.keyframes.find((keyframe) => keyframe.offset === 0.5)!.id;
    hasExplicitKeyframeSelection.value = true;
  }
  renderProjection();
  if (shotConfig.value) renderShotWorkspace();
  if (operation.kind === 'motion.track.create') resolveAcceptedCreationDraft();
  status.value = `${successMessage(operation.kind)} Revision ${authoring.value.document.revision}.`;
  status.dataset.kind = 'success';
  if (cueWorkspace && (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo')) {
    const restored = operation.kind === 'motion.history.undo' ? 'Undid the last change' : 'Redid the last change';
    announceCueStatus(`${restored}. Revision ${authoring.value.document.revision}.`, false);
  }
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

export function serviceCommandForOperation(operation: EditorPersistentOperation): MotionCommand {
  if (operation.schemaVersion === 'motion.operation-intent.v1') return makeOperationIntentCommand(operation, activeBranchId.value);
  return commandSchema.parse({ protocolVersion: 'motion.protocol.v1', operationId: operation.operationId,
    documentId: operation.documentId, branchId: activeBranchId.value, expectedRevision: operation.expectedRevision,
    command: operation });
}

export async function prepareAndDispatchIntent(
  intent: OperationIntentPayload,
  focusSelector?: string,
  historyAnchor?: { viewportTop: number; scrollY: number },
  previewPromotion?: PreviewCssCommitPromotion,
): Promise<{ ok: boolean; code?: string }> {
  const publicationRejection = rejectUnavailablePublication();
  if (publicationRejection) return { ok: false, code: publicationRejection };
  if (!serviceClient) {
    publishClientDiagnostic('SERVICE_REQUIRED', 'protocol', false);
    return { ok: false, code: 'SERVICE_REQUIRED' };
  }
  const expectedRevision = authoring.value.document.revision;
  try {
    const preparation = await serviceClient!.prepareOperation({ schemaVersion: 'motion.operation-preparation-request.v1',
      documentId: authoring.value.document.documentId, branchId: activeBranchId.value, expectedRevision, kind: intent.kind, intent });
    if (!preparation.eligibility || !preparation.normalizedIntent || !preparation.derivationDigest) {
      const code = preparation.reasonCode ?? 'DERIVATION_INVALID';
      publishClientDiagnostic(code, code === 'DERIVATION_STALE' ? 'revision' : 'domain', false);
      return { ok: false, code };
    }
    const prepared: PreparedOperationIntent = { schemaVersion: 'motion.operation-intent.v1', operationId: nextOperationId(),
      documentId: preparation.documentId, expectedRevision: preparation.revision, kind: preparation.kind,
      derivationDigest: preparation.derivationDigest, intent: preparation.normalizedIntent };
    return await dispatch(prepared, focusSelector, historyAnchor, previewPromotion);
  } catch (error) {
    if (error instanceof MotionPreparationError) {
      publishServiceDiagnostic(error.response.diagnostic);
      return { ok: false, code: error.response.diagnostic.code };
    }
    if (publicationState.value === 'failed') return { ok: false, code: 'PUBLICATION_FAILED' };
    publishClientDiagnostic('SERVICE_PREPARATION_FAILED', 'storage', true);
    return { ok: false, code: 'SERVICE_PREPARATION_FAILED' };
  }
}

export function durableUndoAvailable(): boolean { return durableWorkspace.value?.history.undoAvailable === true; }
export function durableRedoAvailable(): boolean { return durableWorkspace.value?.history.redoAvailable === true; }

export async function findCommittedOperation(documentId: string, operationDigest: string): Promise<CommitMetadata | null> {
  if (!serviceClient) return null;
  let cursor = lastCommitSeq.value; const visited = new Set<number>();
  while (!visited.has(cursor)) {
    visited.add(cursor); const page = await serviceClient!.activity(documentId, cursor, 100);
    const match = page.events.find((event) => event.operationDigest === operationDigest); if (match) return match;
    if (page.nextAfterCommitSeq === null) return null; cursor = page.nextAfterCommitSeq;
  }
  return null;
}

export async function fetchDurableContext(documentId: string, branchId = activeBranchId.value): Promise<DurableContextSnapshot> {
  if (!serviceClient) throw new Error('SERVICE_REQUIRED');
  const [workspace, branches, claims, activity] = await Promise.all([
    serviceClient!.workspace(documentId, branchId), serviceClient!.branches(documentId),
    serviceClient!.activeClaims(documentId), serviceClient!.activity(documentId, 0, 25),
  ]);
  return { workspace, branches, claims, activity };
}

export function publishDurableContext(snapshot: DurableContextSnapshot): void {
  const { workspace, branches, claims, activity } = snapshot;
  durableWorkspace.value = workspace; durableBranches.value = branches; durableClaims.value = claims; durableActivity.value = activity;
  required('[data-collaboration-branch]').textContent = activeBranchId.value;
  required('[data-collaboration-revision]').textContent = String(workspace.revision);
  const latest = activity.events.at(-1);
  required('[data-collaboration-actor]').textContent = latest?.actor
    ? `${latest.actor.kind} · ${latest.actor.actorId ?? 'legacy'}` : 'Awaiting activity';
  const activeClaim = claims.claims[0];
  required('[data-collaboration-claim]').textContent = activeClaim
    ? `${activeClaim.scope} · ${activeClaim.holder.actorId ?? 'legacy'}` : 'None';
  if (branchSelect) {
    const selected = activeBranchId.value; branchSelect.replaceChildren(...branches.branches.map((branch) => new Option(
      `${branch.branchId} · r${branch.headRevision}`, branch.branchId, false, branch.branchId === selected)));
  }
  const activityList = required<HTMLOListElement>('[data-collaboration-activity]'); activityList.replaceChildren();
  for (const event of activity.events.slice(-8).reverse()) {
    const item = document.createElement('li');
    item.textContent = `r${event.revision} · ${event.kind} · ${event.actor?.kind ?? 'legacy'} · ${event.actor?.actorId ?? 'legacy'}`;
    activityList.append(item);
  }
  const eligibilityList = required<HTMLUListElement>('[data-collaboration-eligibility]'); eligibilityList.replaceChildren();
  for (const entry of workspace.eligibility) {
    const item = document.createElement('li'); item.dataset.eligible = String(entry.eligible);
    item.textContent = `${entry.kind}: ${entry.eligible ? 'available' : entry.reasonCode}`; eligibilityList.append(item);
  }
  undoButton.disabled = !workspace.history.undoAvailable;
  redoButton.disabled = !workspace.history.redoAvailable;
  if (cueWorkspace) required<HTMLElement>('[data-cue-history-slot]').hidden = undoButton.disabled && redoButton.disabled;
}

export async function refreshDurableContext(): Promise<void> {
  if (!serviceClient) return;
  publishDurableContext(await fetchDurableContext(authoring.value.document.documentId));
}
