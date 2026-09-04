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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export function renderShotWorkspace(): void {
  if (!shotConfig.value) return;
  const momentBeforeReconciliation = shotMomentMs.value;
  shotTargets.querySelectorAll('label').forEach((item) => item.remove());
  for (const [index, elementId] of shotConfig.value.targetElementIds.entries()) {
    const label = document.createElement('label'); label.className = 'shot-object';
    const primary = document.createElement('input'); primary.type = 'radio'; primary.name = 'shot-primary'; primary.value = elementId;
    primary.checked = elementId === shotPrimaryElementId.value; primary.setAttribute('aria-label', `Primary Object ${index + 1}`);
    primary.addEventListener('change', () => { if (primary.checked) selectShotPrimary(elementId); });
    const copy = document.createElement('span'); copy.innerHTML = `<strong>Object ${index + 1}</strong><small>Primary</small>`;
    label.append(primary, copy); shotTargets.append(label);
  }
  const primary = shotPrimaryElementId.value ?? shotSelection.value[0]!; const inventories = canonicalShotInventory();
  const primaryInventory = inventories?.find((inventory) => inventory.elementId === primary);
  if (!inventories || !primaryInventory) { shotGeometry.value = []; shotProjection.value = null; shotOverlay.replaceChildren();
    shotOverlay.setAttribute('aria-busy', 'false'); shotStatus.value = 'TRAJECTORY_INVENTORY_DIVERGED'; return; }
  const moveTogether = required<HTMLInputElement>('[data-move-together]');
  const primaryTimes = primaryInventory.waypoints.map((waypoint) => waypoint.timeMs);
  const sharedTimes = primaryTimes.filter((timeMs) => isSharedShotMoment(inventories, shotConfig.value!.targetElementIds, timeMs));
  if (moveTogether.checked && !sharedTimes.includes(shotMomentMs.value)) {
    if (sharedTimes.length > 0) shotMomentMs.value = [...sharedTimes]
      .sort((left, right) => Math.abs(left - shotMomentMs.value) - Math.abs(right - shotMomentMs.value) || left - right)[0]!;
    else { moveTogether.checked = false; shotSelection.value = [primary]; }
  }
  if (moveTogether.checked) shotSelection.value = [...shotConfig.value.targetElementIds];
  const requestedTimes = moveTogether.checked ? sharedTimes : primaryTimes;
  if (!requestedTimes.includes(shotMomentMs.value)) shotMomentMs.value = [...requestedTimes]
    .sort((left, right) => Math.abs(left - shotMomentMs.value) - Math.abs(right - shotMomentMs.value) || left - right)[0]!;
  if (shotMode.value === 'path' && shotMomentMs.value !== momentBeforeReconciliation && !alignShotPreviewToMoment(shotMomentMs.value)) return;
  moveTogether.disabled = !moveTogether.checked && !sharedTimes.includes(shotMomentMs.value);
  renderShotContextDock(inventories);
  const displayedWaypoints = primaryInventory.waypoints.filter((waypoint) => requestedTimes.includes(waypoint.timeMs));
  const displayedPaths = inventories.map((inventory, objectIndex) => ({ elementId: inventory.elementId, objectIndex,
    waypoints: inventory.waypoints.map(({ keyframeId, timeMs }) => ({ keyframeId, timeMs })) }));
  const geometryTimes = [...new Set(displayedPaths.flatMap((path) => path.waypoints.map((waypoint) => waypoint.timeMs)))].sort((a, b) => a - b);
  const momentSequence = required<HTMLElement>('[data-shot-moment-sequence]', shotMoments);
  momentSequence.replaceChildren();
  for (const [index, timeMs] of requestedTimes.entries()) {
    if (index > 0 && timeMs - requestedTimes[index - 1]! > 1) {
      const beforeMs = requestedTimes[index - 1]!; const add = document.createElement('button'); add.type = 'button';
      add.className = 'moment-add'; add.textContent = '+'; add.setAttribute('aria-label',
        `Add a point between ${shotMomentLabel(beforeMs)} and ${shotMomentLabel(timeMs)}`);
      add.addEventListener('click', () => void addShotMoment(beforeMs, timeMs)); momentSequence.append(add);
    }
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'radio'; input.name = 'shot-moment';
    input.value = String(timeMs); input.checked = timeMs === shotMomentMs.value;
    input.addEventListener('change', () => { if (input.checked) selectShotMoment(timeMs); });
    const copy = document.createElement('span'); copy.innerHTML = `<strong>${shotMomentLabel(timeMs)}</strong><small>${timeMs} ms</small>`;
    label.append(input, copy); momentSequence.append(label);
  }
  const projection = readShotProjection();
  if (!projection) { shotGeometry.value = []; committedShotGeometryKey.value = null; shotOverlay.replaceChildren();
    shotOverlay.setAttribute('aria-busy', 'false'); return; }
  const geometryKey = sha256Hex(canonicalJson({ mountedPreviewGeneration, compilerDigest: compiled.value.exportDigest, primaryElementId: primary,
    waypoints: displayedWaypoints.map(({ keyframeId, timeMs }) => ({ keyframeId, timeMs })), paths: displayedPaths, requestedTimes: geometryTimes,
    projection: { sourceWidthCssPixels: projection.sourceWidthCssPixels, sourceHeightCssPixels: projection.sourceHeightCssPixels,
      displayLeft: projection.displayLeft, displayTop: projection.displayTop, displayWidth: projection.displayWidth,
      displayHeight: projection.displayHeight, scaleX: projection.scaleX, scaleY: projection.scaleY,
      devicePixelRatio: projection.devicePixelRatio } }));
  const latestKey = latestShotGeometryRequest.value?.geometryKey;
  if (geometryKey !== latestKey) {
    const geometryGeneration = ++shotGeometryGeneration.value;
    publishShotGeometry({ workspaceGeneration: geometryGeneration, primaryElementId: primary, geometryKey,
      waypoints: displayedWaypoints, paths: displayedPaths, requestedTimes: geometryTimes });
  } else if (committedShotGeometryKey.value !== geometryKey && !pendingShotGeometryRequest.value && !shotGeometryPumpRunning.value) {
    publishShotGeometry({ workspaceGeneration: shotGeometryGeneration.value, primaryElementId: primary, geometryKey,
      waypoints: displayedWaypoints, paths: displayedPaths, requestedTimes: geometryTimes });
  }
  const selected = primaryInventory.waypoints.find((point) => point.timeMs === shotMomentMs.value);
  const primaryLabel = `Object ${shotConfig.value.targetElementIds.indexOf(primary) + 1}`;
  const momentLabel = shotMomentLabel(shotMomentMs.value);
  shotWorkspace.dataset.mode = shotMode.value;
  syncPreviewShotToolbar(requestedTimes);
  previewSelectionLabel.textContent = `${primaryLabel} selected`;
  shotGuidance.textContent = `Editing ${primaryLabel} at ${momentLabel}. Drag the object to move it, any corner to scale uniformly, or the rotation handle above it to rotate.${moveTogether.checked ? ' Object movement translates both objects together.' : ''}${shotMode.value === 'path' ? ' Path waypoints are visible and draggable.' : ''}`;
  const controls = shotPoseForm.elements as unknown as Record<string, HTMLInputElement>;
  for (const control of shotPoseForm.querySelectorAll<HTMLInputElement>('input')) control.disabled = !selected;
  if (selected) { controls.x!.value = String(selected.pose.translateXMicrounits / 1_000_000); controls.y!.value = String(selected.pose.translateYMicrounits / 1_000_000);
    controls.scale!.value = String(selected.pose.scalePpm / 1_000_000); controls.rotate!.value = String(selected.pose.rotateMicrodegrees / 1_000_000); }
  shotOverlay.dataset.mode = shotMode.value;
  previewObjectOverlay.dataset.mode = shotMode.value;
  shotOverlay.toggleAttribute('inert', shotMode.value !== 'path');
  syncReferencePathSelection();
  for (const handle of shotOverlay.querySelectorAll<HTMLElement>('[data-keyframe-id][data-time-ms]')) {
    handle.setAttribute('aria-pressed', String(Number(handle.dataset.timeMs) === shotMomentMs.value));
  }
  const currentGeometry = committedShotGeometryKey.value === geometryKey;
  shotOverlay.setAttribute('aria-busy', String(!currentGeometry));
  shotStatus.value = publicationState.value === 'failed'
    ? 'Change could not be published. Your previous motion is still active.'
    : currentGeometry ? `${primaryLabel} · ${momentLabel} ready.` : 'Updating canvas…';
  schedulePreviewSelection();
}

export function renderShotContextDock(inventories: NonNullable<ReturnType<typeof canonicalShotInventory>>): void {
  if (!shotConfig.value) return;
  const editTogether = required<HTMLInputElement>('[data-move-together]').checked;
  const sharedTimes = inventories[0]!.waypoints.map((waypoint) => waypoint.timeMs)
    .filter((timeMs) => inventories.every((inventory) => inventory.waypoints.some((waypoint) => waypoint.timeMs === timeMs)))
    .sort((left, right) => left - right);
  const primaryTimes = inventories.find((inventory) => inventory.elementId === shotPrimaryElementId.value)?.waypoints
    .map((waypoint) => waypoint.timeMs).sort((left, right) => left - right) ?? [];
  const editableTimes = editTogether ? sharedTimes : primaryTimes;
  const selectedIndex = editableTimes.indexOf(shotMomentMs.value);
  const protectedMoment = shotMomentMs.value === shotConfig.value.startMs || shotMomentMs.value === shotConfig.value.settledMs;
  const noFollowingEditableSegment = selectedIndex < 0 || selectedIndex === editableTimes.length - 1;
  required<HTMLElement>('[data-shot-context-name]').textContent = shotMomentLabel(shotMomentMs.value);
  const timeInput = required<HTMLInputElement>('[data-shot-context-time]');
  const timeOutput = required<HTMLOutputElement>('[data-shot-moment-time-output]');
  timeInput.min = String((editableTimes[selectedIndex - 1] ?? shotMomentMs.value - 1) + 1);
  timeInput.max = String((editableTimes[selectedIndex + 1] ?? shotMomentMs.value + 1) - 1);
  timeInput.value = String(shotMomentMs.value); timeOutput.value = `${shotMomentMs.value} ms`;
  timeInput.disabled = protectedMoment || selectedIndex < 0;
  const remove = required<HTMLButtonElement>('[data-shot-context-remove]');
  remove.hidden = timeInput.disabled;
  remove.disabled = timeInput.disabled || editableTimes.length <= 3;
  const editingElementIds = editTogether ? shotConfig.value.targetElementIds : shotPrimaryElementId.value ? [shotPrimaryElementId.value] : [];
  const selected = projectTrajectorySelection(authoring.value.document, editingElementIds, shotMomentMs.value);
  const easing = required<HTMLSelectElement>('[data-shot-context-easing]');
  const applyEasing = required<HTMLButtonElement>('[data-shot-apply-easing]');
  easing.disabled = !selected.eligible || noFollowingEditableSegment;
  applyEasing.disabled = easing.disabled;
  if (!selected.eligible) return;
  const timings = effectiveShotTimings(selected.targets);
  if (timings && timings.every((timing) => canonicalJson(timing) === canonicalJson(timings[0]))) {
    const timing = timings[0]!;
    easing.value = timing.kind === 'keyword' ? timing.value : 'custom';
  }
}

export function publishShotGeometry(request: Omit<ShotGeometryRequest, 'requestId'>): void {
  const published = { ...request, requestId: ++shotGeometryRequestId.value,
    waypoints: request.waypoints.map((waypoint) => ({ ...waypoint })),
    paths: request.paths.map((path) => ({ ...path, waypoints: path.waypoints.map((waypoint) => ({ ...waypoint })) })),
    requestedTimes: [...request.requestedTimes] };
  latestShotGeometryRequest.value = published; pendingShotGeometryRequest.value = published;
  shotOverlay.setAttribute('aria-busy', 'true');
  shotStatus.value = 'Updating canvas…';
  if (!shotGeometryPumpRunning.value) shotGeometryPumpCompletion.value = pumpShotGeometry();
}

export function republishShotGeometry(): void {
  if (!shotConfig.value || !latestShotGeometryRequest.value) return;
  if (committedShotGeometryKey.value === latestShotGeometryRequest.value.geometryKey) return;
  publishShotGeometry({ workspaceGeneration: latestShotGeometryRequest.value.workspaceGeneration,
    primaryElementId: latestShotGeometryRequest.value.primaryElementId, geometryKey: latestShotGeometryRequest.value.geometryKey,
    waypoints: latestShotGeometryRequest.value.waypoints, paths: latestShotGeometryRequest.value.paths,
    requestedTimes: latestShotGeometryRequest.value.requestedTimes });
}

export function isCurrentShotGeometryRequest(request: ShotGeometryRequest): boolean {
  return latestShotGeometryRequest.value?.requestId === request.requestId && request.workspaceGeneration === shotGeometryGeneration.value
    && Boolean(shotConfig.value) && request.primaryElementId === shotPrimaryElementId.value;
}

export async function pumpShotGeometry(): Promise<void> {
  if (shotGeometryPumpRunning.value) return;
  shotGeometryPumpRunning.value = true;
  try {
    while (pendingShotGeometryRequest.value) {
      const request = pendingShotGeometryRequest.value; pendingShotGeometryRequest.value = null;
      await processShotGeometryRequest(request);
    }
  } finally {
    shotGeometryPumpRunning.value = false;
    if (pendingShotGeometryRequest.value) shotGeometryPumpCompletion.value = pumpShotGeometry();
  }
}

export async function awaitShotGeometryCommit(): Promise<void> {
  while (shotGeometryPumpRunning.value || pendingShotGeometryRequest.value) {
    const completion = shotGeometryPumpCompletion.value;
    await completion;
    if (completion === shotGeometryPumpCompletion.value && !shotGeometryPumpRunning.value && !pendingShotGeometryRequest.value) return;
  }
}

export function refreshTrajectorySegments(): void {
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

export function syncReferencePathSelection(): void {
  for (const item of shotOverlay.querySelectorAll<HTMLElement>('[data-reference-segment], [data-reference-waypoint]')) {
    item.dataset.selected = String(Boolean(item.dataset.elementId && shotSelection.value.includes(item.dataset.elementId)));
  }
}

export function renderReferencePaths(request: ShotGeometryRequest,
  samples: Awaited<ReturnType<NativePreviewController['measureTargetBoundsAtTimes']>>): void {
  const existingPoints = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-reference-waypoint]')]
    .map((point) => [point.dataset.referenceWaypoint!, point]));
  const existingSegments = new Map([...shotOverlay.querySelectorAll<HTMLElement>('[data-reference-segment]')]
    .map((segment) => [segment.dataset.referenceSegment!, segment]));
  const desiredPoints = new Set<string>(); const desiredSegments = new Set<string>();
  for (const path of request.paths) {
    const selected = shotSelection.value.includes(path.elementId);
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

export async function processShotGeometryRequest(request: ShotGeometryRequest): Promise<void> {
  if (!isCurrentShotGeometryRequest(request)) return;
  let samples: Awaited<ReturnType<NativePreviewController['measureTargetBoundsAtTimes']>>;
  try {
    activeShotGeometrySamplers.value += 1; maximumActiveShotGeometrySamplers.value = Math.max(maximumActiveShotGeometrySamplers.value, activeShotGeometrySamplers.value);
    samples = await controller.measureTargetBoundsAtTimes(shotConfig.value!.targetElementIds, request.requestedTimes);
  } catch (error) {
    if (error instanceof Error && error.message === 'PREVIEW_GEOMETRY_SUPERSEDED') return;
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection.value = null; shotGeometry.value = []; shotOverlay.replaceChildren(); shotOverlay.setAttribute('aria-busy', 'false');
    const code = error instanceof Error ? error.message : 'PREVIEW_GEOMETRY_INVALID';
    shotStatus.value = `${code} · revision ${authoring.value.document.revision} unchanged.`;
    return;
  } finally {
    activeShotGeometrySamplers.value -= 1;
  }
  if (!isCurrentShotGeometryRequest(request)) return;
  try {
    const projection = readShotProjection();
    if (!projection) { shotProjection.value = null; shotGeometry.value = []; shotOverlay.replaceChildren();
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
        const label = document.createElement('span'); label.className = 'trajectory-waypoint-label';
        const name = document.createElement('strong'); name.className = 'trajectory-waypoint-name';
        const time = document.createElement('small'); time.className = 'trajectory-waypoint-time';
        label.append(name, time); handle.append(label);
        handle.addEventListener('click', () => { if (handle!.dataset.dragged === 'true') return;
          const timeMs = Number(handle!.dataset.timeMs);
          if (alignShotPreviewToMoment(timeMs)) { shotMomentMs.value = timeMs; renderShotWorkspace(); } });
        handle.addEventListener('pointerdown', (event) => beginWaypointDrag(event, Number(handle!.dataset.timeMs)));
      }
      handle.dataset.keyframeId = waypoint.keyframeId; handle.dataset.timeMs = String(waypoint.timeMs);
      handle.dataset.elementId = request.primaryElementId;
      handle.dataset.label = shotMomentLabel(waypoint.timeMs);
      handle.querySelector<HTMLElement>('.trajectory-waypoint-name')!.textContent = handle.dataset.label;
      handle.querySelector<HTMLElement>('.trajectory-waypoint-time')!.textContent = `${waypoint.timeMs} ms`;
      handle.setAttribute('aria-label', `${handle.dataset.label}, ${waypoint.timeMs} ms, compiler-native target bounds`);
      handle.setAttribute('aria-pressed', String(waypoint.timeMs === shotMomentMs.value));
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
    const placedLabels: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    for (const handle of orderedHandles) {
      const label = handle.querySelector<HTMLElement>('.trajectory-waypoint-label')!;
      label.style.translate = '';
      const left = handle.offsetLeft - 1;
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      const baseTop = handle.offsetTop + handle.offsetHeight + 4;
      let shift = 0;
      while (placedLabels.some((placed) => left < placed.right && left + width > placed.left
        && baseTop + shift < placed.bottom && baseTop + shift + height > placed.top)) shift += height + 4;
      label.style.translate = shift ? `0 ${shift}px` : '';
      placedLabels.push({ left, right: left + width, top: baseTop + shift, bottom: baseTop + shift + height });
    }
    refreshTrajectorySegments();
    const nextGeometry: typeof shotGeometry.value = [];
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
    shotProjection.value = projection; shotGeometry.value = nextGeometry; lastCommittedShotGeometryRequestId.value = request.requestId;
    committedShotGeometryKey.value = request.geometryKey;
    shotOverlay.setAttribute('aria-busy', 'false');
    const objectLabel = `Object ${shotConfig.value!.targetElementIds.indexOf(request.primaryElementId) + 1}`;
    shotStatus.value = publicationState.value === 'failed'
      ? 'Change could not be published. Your previous motion is still active.'
      : `${objectLabel} · ${shotMomentLabel(shotMomentMs.value)} ready.`;
  } catch (error) {
    if (!isCurrentShotGeometryRequest(request)) return;
    shotProjection.value = null; shotGeometry.value = []; shotOverlay.replaceChildren(); shotOverlay.setAttribute('aria-busy', 'false');
    const code = error instanceof Error ? error.message : 'PREVIEW_GEOMETRY_INVALID';
    shotStatus.value = `${code} · revision ${authoring.value.document.revision} unchanged.`;
  }
}
