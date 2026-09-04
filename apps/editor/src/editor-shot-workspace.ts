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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export function openShotWorkspace(config: { startMs: number; landedMs: number; settledMs: number; targetElementIds: string[] }): { ok: boolean; code?: string } {
  const projection = projectShotWorkspace(authoring.value.document, config);
  if (!projection.eligible) { const code = projection.code ?? 'SHOT_WORKSPACE_UNAVAILABLE'; shotStatus.value = `${code} · revision ${authoring.value.document.revision} unchanged.`; return { ok: false, code }; }
  const source = controller.sourceSize();
  if (!Number.isSafeInteger(source.widthCssPixels) || source.widthCssPixels <= 0
    || !Number.isSafeInteger(source.heightCssPixels) || source.heightCssPixels <= 0 || !readShotProjection()) {
    const code = 'PREVIEW_SOURCE_SIZE_INVALID'; shotStatus.value = `${code} · revision ${authoring.value.document.revision} unchanged.`;
    return { ok: false, code };
  }
  shotConfig.value = { ...config, targetElementIds: [...config.targetElementIds].sort() };
  shotWorkspace.removeAttribute('aria-disabled'); shotWorkspace.dataset.active = 'true'; shotWorkspace.dataset.editable = 'true';
  shotRecovery.hidden = true; shotStatus.setAttribute('role', 'status');
  forEachShotControl((control) => { control.disabled = false; });
  shotPrimaryElementId.value = shotConfig.value.targetElementIds[0]!;
  shotSelection.value = [shotPrimaryElementId.value]; shotMomentMs.value = config.landedMs; shotWorkspace.hidden = false; shotMoments.hidden = false;
  activateShotLayout(); configurePreviewCanvas();
  scrubber.max = String(shotConfig.value.settledMs + 1);
  if (!alignShotPreviewToMoment(shotMomentMs.value)) return { ok: false, code: 'PREVIEW_MOMENT_ALIGNMENT_INVALID' };
  renderShotWorkspace(); configurePreviewCanvas(); renderShotWorkspace(); return { ok: true };
}

export function activateShotLayout(): void {
  const shell = required<HTMLElement>('.editor-shell');
  required<HTMLElement>('[data-shot-history-slot]').append(required<HTMLElement>('.workflow-footer'));
  mountShotAdvancedSurfaces();
  shell.classList.add('shot-active');
  required<HTMLElement>('.topbar h1').textContent = 'Shape motion directly on the canvas';
  required<HTMLElement>('.purpose').textContent = 'Choose an object and a moment. Add points when the path needs another beat.';
}

export function mountShotAdvancedSurfaces(): void {
  const technical = required<HTMLElement>('[data-shot-advanced-technical]');
  const collaboration = document.querySelector<HTMLElement>('.collaboration-bar');
  const inspector = required<HTMLDetailsElement>('.inspect-panel');
  if (collaboration) technical.append(collaboration);
  technical.append(inspector);
}

export function forEachShotControl(callback: (control: HTMLInputElement | HTMLButtonElement | HTMLSelectElement) => void): void {
  for (const root of [required<HTMLElement>('[data-shot-object-bar]'), required<HTMLElement>('[data-shot-context-dock]'),
    shotAdvancedDrawer, shotMoments]) {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(callback);
  }
}

export function initializeSeedWorkspace(): void {
  const metadata = payload.shotWorkspace;
  if (!metadata) return;
  const structuralElementIds = authoring.value.document.elements.map((element) => element.id).sort();
  const targets = [...metadata.targetElementIds];
  const bindingValid = metadata.schemaVersion === 'motion.editor-shot-workspace.v1'
    && metadata.documentId === authoring.value.document.documentId
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

export function showSeedWorkspaceFailure(code: string): void {
  shotConfig.value = null;
  shotSelection.value = [];
  shotPrimaryElementId.value = null;
  shotWorkspace.hidden = false; shotWorkspace.dataset.active = 'true'; shotMoments.hidden = true;
  shotWorkspace.removeAttribute('aria-disabled'); shotWorkspace.dataset.editable = 'false';
  forEachShotControl((control) => { control.disabled = true; });
  shotRecovery.hidden = false;
  required<HTMLElement>('[data-shot-recovery-copy]').textContent = `${code}. The committed document was not changed. Restore a compatible Shot 1 revision or source, then retry; you can still inspect every track now.`;
  required<HTMLButtonElement>('[data-shot-retry]').disabled = false;
  required<HTMLButtonElement>('[data-shot-inspect]').disabled = false;
  shotStatus.setAttribute('role', 'alert');
  shotStatus.value = `${code} · revision ${authoring.value.document.revision} unchanged. Manual Shot editing is unavailable.`;
}

export function canonicalShotInventory() {
  if (!shotConfig.value) return null;
  const inventories = shotConfig.value.targetElementIds.map((elementId) => {
    const trajectory = projectTransformTrajectory(authoring.value.document, elementId);
    if (!trajectory.eligible) return null;
    const waypoints = trajectory.waypoints.filter((waypoint) => waypoint.timeMs >= shotConfig.value!.startMs && waypoint.timeMs <= shotConfig.value!.settledMs)
      .sort((left, right) => left.timeMs - right.timeMs || left.keyframeId.localeCompare(right.keyframeId));
    if (waypoints.some((waypoint) => !Number.isSafeInteger(waypoint.timeMs) || !waypoint.keyframeId)
      || new Set(waypoints.map((waypoint) => waypoint.timeMs)).size !== waypoints.length) return null;
    return { elementId, waypoints };
  });
  const validInventories = inventories.filter((inventory): inventory is NonNullable<typeof inventory> => inventory !== null);
  if (validInventories.length !== shotConfig.value.targetElementIds.length) return null;
  return validInventories;
}

export function isSharedShotMoment(inventories: NonNullable<ReturnType<typeof canonicalShotInventory>>, elementIds: string[], timeMs: number): boolean {
  return elementIds.every((elementId) => inventories.find((inventory) => inventory.elementId === elementId)
    ?.waypoints.some((waypoint) => waypoint.timeMs === timeMs) === true);
}

export function selectShotPrimary(elementId: string): void {
  if (!shotConfig.value || !shotConfig.value.targetElementIds.includes(elementId)) return;
  shotPrimaryElementId.value = elementId;
  shotSelection.value = required<HTMLInputElement>('[data-move-together]').checked ? [...shotConfig.value.targetElementIds] : [elementId];
  renderShotWorkspace(); schedulePreviewSelection();
}

export function selectShotMode(nextMode: 'pose' | 'path'): void {
  if (nextMode === 'path' && !alignShotPreviewToMoment(shotMomentMs.value)) return;
  shotMode.value = nextMode;
  shotWorkspace.querySelectorAll<HTMLButtonElement>('[data-shot-mode]').forEach((item) =>
    { item.setAttribute('aria-pressed', String(nextMode === 'path'));
      item.textContent = nextMode === 'path' ? 'Hide path' : 'Show path'; });
  renderShotWorkspace();
}

export function selectShotMoment(timeMs: number): void {
  if (!alignShotPreviewToMoment(timeMs)) return;
  shotMomentMs.value = timeMs; renderShotWorkspace();
}

export function focusShotMoment(timeMs: number): void {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>(
    `input[name="shot-moment"][value="${timeMs}"]`)?.focus());
}

export function shotMomentLabel(timeMs: number): string {
  if (timeMs === shotConfig.value?.startMs) return 'Start';
  if (timeMs === shotConfig.value?.settledMs) return 'Settle';
  const trajectory = shotPrimaryElementId.value ? projectTransformTrajectory(authoring.value.document, shotPrimaryElementId.value) : null;
  const intermediate = trajectory?.eligible ? trajectory.waypoints
    .filter((point) => point.timeMs > (shotConfig.value?.startMs ?? 0) && point.timeMs < (shotConfig.value?.settledMs ?? 2100)) : [];
  const index = intermediate.findIndex((point) => point.timeMs === timeMs);
  return index >= 0 ? `Point ${index + 1}` : `${timeMs} ms`;
}

export function updatePreviewPlaybackState(timeMs?: number, paused = false): void {
  const editing = shotMomentLabel(shotMomentMs.value);
  previewShotState.value = timeMs === undefined ? `Editing ${editing}`
    : `${paused ? 'Paused' : 'Previewing'} ${Math.round(timeMs)} ms · ${editing}`;
}

export function syncPreviewShotToolbar(requestedTimes: number[]): void {
  previewShotToolbar.hidden = !shotConfig.value;
  if (!shotConfig.value || !shotPrimaryElementId.value) return;
  const primaryIndex = shotConfig.value.targetElementIds.indexOf(shotPrimaryElementId.value);
  previewShotObject.textContent = `Object ${primaryIndex + 1}`;
  if (playbackFeedbackFrame.value === null) updatePreviewPlaybackState();
  const descriptors = [
    { key: 'mode:path', label: 'Path', ariaLabel: 'Show path overlay', pressed: shotMode.value === 'path',
      action: () => selectShotMode(shotMode.value === 'path' ? 'pose' : 'path') },
    ...shotConfig.value.targetElementIds.map((elementId, index) => ({ key: `primary:${elementId}`, label: `Object ${index + 1}`,
      ariaLabel: `Edit Object ${index + 1} from preview`, pressed: elementId === shotPrimaryElementId.value,
      action: () => selectShotPrimary(elementId) })),
    ...requestedTimes.map((timeMs) => ({ key: `moment:${timeMs}`, label: shotMomentLabel(timeMs),
      ariaLabel: `Edit ${shotMomentLabel(timeMs)} waypoint from preview`, pressed: timeMs === shotMomentMs.value,
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
