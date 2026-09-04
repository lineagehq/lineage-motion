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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export function updateStructuralControls(rows: TimelineRow[]): void {
  const locked = (authoring.value.document.holds ?? []).length > 0;
  const track = findCreatedTrack(rows);
  const hasTrack = Boolean(track);
  const hasMidpoint = Boolean(track?.keyframes.some((keyframe) => keyframe.offset === 0.5));
  for (const choice of creationChoices) {
    const eligibility = projectTrackCreationEligibility(authoring.value.document, choice.elementId, 'opacity');
    const radio = required<HTMLInputElement>(`input[name="creation-target"][value="${choice.elementId}"]`);
    radio.disabled = locked || !eligibility.available;
    required(`[data-choice-reason="${choice.elementId}"]`).textContent = eligibility.available
      ? 'Available' : eligibilityReason(eligibility.reason);
  }
  const selectedEligibility = selectedCreationElementId.value
    ? projectTrackCreationEligibility(authoring.value.document, selectedCreationElementId.value, 'opacity') : null;
  unavailableCreation.value = Boolean(selectedCreationElementId.value && !selectedEligibility?.available);
  createTrackButton.disabled = locked || !selectedEligibility?.available;
  createTrackButton.textContent = selectedCreationElementId.value
    ? `Create ${creationChoices.find((choice) => choice.elementId === selectedCreationElementId.value)!.label} opacity track`
    : 'Select an element';
  addMidpointButton.disabled = locked || !hasTrack || hasMidpoint;
  removeMidpointButton.disabled = locked || !hasMidpoint;
  for (const control of [durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton]) {
    control.disabled = locked || !hasTrack;
  }
  hydrateTimingControls(track);
  required('[data-structural-status]').textContent = locked
    ? 'Hold inserted. Undo the hold before making another edit.' : !selectedCreationElementId.value
    ? 'Select an available element to begin.'
    : !hasTrack && selectedEligibility?.available
      ? `${creationChoices.find((choice) => choice.elementId === selectedCreationElementId.value)!.label} is ready to animate.`
      : !hasTrack ? eligibilityReason(selectedEligibility?.reason ?? null)
    : hasMidpoint ? 'Midpoint ready. Adjust timing or remove it.' : 'Track ready. Add a midpoint or adjust timing.';
}

export function hydrateTimingControls(track: TimelineRow | undefined): void {
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

export function updateTimingDraftState(control: HTMLInputElement | HTMLSelectElement): void {
  const track = findCreatedTrack(buildTimeline(authoring.value.document).rows);
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

export function eligibilityReason(reason: ReturnType<typeof projectTrackCreationEligibility>['reason']): string {
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

export function findCreatedTrack(rows: TimelineRow[]): TimelineRow | undefined {
  return rows.find((row) => creationChoices.some((choice) => choice.elementId === row.elementId)
    && row.property === 'opacity');
}

export function diagnosticMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTHORING_DURATION_INVALID: 'Enter a whole-number duration greater than 0.',
    AUTHORING_DELAY_INVALID: 'Enter a whole-number delay of 0 or greater.',
    AUTHORING_TRACK_NOT_FOUND: 'Create the cursor opacity track first.',
    AUTHORING_HOLD_LOCKED: 'Undo the hold before making another edit.',
  };
  return messages[code] ?? 'That change could not be applied.';
}

export function rejectAuthoringInput(input: HTMLInputElement, code: 'AUTHORING_DURATION_INVALID' | 'AUTHORING_DELAY_INVALID'): void {
  input.setAttribute('aria-invalid', 'true'); input.focus({ preventScroll: true });
  status.value = `${diagnosticMessage(code)} (${code}) Revision ${authoring.value.document.revision} unchanged.`;
  status.dataset.kind = 'error'; status.dataset.source = 'validation';
}

export function successMessage(kind: AuthoringOperation['kind']): string {
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

export function updateSelection(): void {
  const row = selectedTrackId.value
    ? buildTimeline(authoring.value.document).rows.find((candidate) => candidate.trackId === selectedTrackId.value) : undefined;
  const keyframe = row?.keyframes.find((candidate) => candidate.id === selectedKeyframeId.value);
  unavailableSelection.value = Boolean(hasExplicitKeyframeSelection.value && (!row || !keyframe));
  const locked = (authoring.value.document.holds ?? []).length > 0;
  valueInput.disabled = locked || !hasExplicitKeyframeSelection.value;
  timeInput.disabled = locked || !hasExplicitKeyframeSelection.value;
  valueButton.disabled = locked || !hasExplicitKeyframeSelection.value;
  timeButton.disabled = locked || !hasExplicitKeyframeSelection.value;
  if (unavailableSelection.value) {
    disableUnavailableMutationControls();
    required('[data-selection]').innerHTML = `<div class="selection-summary unavailable"><strong>Selected canonical target unavailable</strong><span>Track ${selectedTrackId.value} · keyframe ${selectedKeyframeId.value}</span></div>`;
    previewSelectionLabel.textContent = 'Selection unavailable'; previewSelection.hidden = true; return;
  }
  if (!hasExplicitKeyframeSelection.value) {
    required('[data-selection]').innerHTML = `<div class="selection-summary"><strong>No keyframe selected</strong><span>Open Inspect all tracks and choose a keyframe for exact editing.</span></div>`;
    previewSelectionLabel.textContent = selectedCreationElementId.value ? 'Element chosen' : '';
    schedulePreviewSelection();
    return;
  }
  selectedKeyframeId.value = keyframe!.id;
  required('[data-selection]').innerHTML = `
    <div class="selection-summary"><strong>Selected ${row!.property} keyframe</strong><span>Revision ${authoring.value.document.revision}</span></div>
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

export function disableUnavailableMutationControls(): void {
  for (const control of [createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput,
    setDurationButton, setDelayButton, setEasingButton, valueInput, timeInput, valueButton, timeButton, insertHoldButton])
    control.disabled = true;
}

export function findEditableTrack(): TimelineRow | null {
  const timeline = buildTimeline(authoring.value.document);
  const created = findCreatedTrack(timeline.rows);
  if (created) return created;
  const editable = timeline.rows.filter((row) => row.property === 'opacity'
    && timeline.rows.filter((candidate) => candidate.ruleId === row.ruleId && candidate.property === row.property).length === 1);
  return editable.length === 1 ? editable[0]! : null;
}

export function currentTarget(): TimelineRow {
  const selected = selectedTrackId.value
    ? buildTimeline(authoring.value.document).rows.find((row) => row.trackId === selectedTrackId.value) : undefined;
  if (!selected || !selectedKeyframeId.value || !selected.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId.value)) {
    throw new Error('EDITOR_KEYFRAME_SELECTION_MISSING');
  }
  return selected;
}

export function scrub(timeMs: number): void {
  stopPlaybackFeedback();
  controller.scrub(timeMs); scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`;
  updatePreviewPlaybackState();
  republishShotGeometry();
  schedulePreviewSelection();
  scheduleCueCanvas();
}

export function stopPlaybackFeedback(): void {
  if (playbackFeedbackFrame.value !== null) cancelAnimationFrame(playbackFeedbackFrame.value);
  playbackFeedbackFrame.value = null;
}

export function syncPlaybackFeedback(): void {
  const state = controller.readState();
  const nativeTime = state.currentTimes.find((time): time is number => typeof time === 'number');
  if (nativeTime === undefined) return;
  const shotEndMs = shotConfig.value?.settledMs;
  if (shotEndMs !== undefined && nativeTime >= shotEndMs) {
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

export function startPlaybackFeedback(): void {
  stopPlaybackFeedback();
  const tick = () => {
    syncPlaybackFeedback();
    if (controller.readState().playStates.some((playState) => playState === 'running')) playbackFeedbackFrame.value = requestAnimationFrame(tick);
    else playbackFeedbackFrame.value = null;
  };
  playbackFeedbackFrame.value = requestAnimationFrame(tick);
}

export function alignShotPreviewToMoment(timeMs: number): boolean {
  if (!Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > authoring.value.document.durationMs) {
    shotStatus.value = `PREVIEW_TIME_INVALID · revision ${authoring.value.document.revision} unchanged.`; return false;
  }
  stopPlaybackFeedback(); controller.scrub(timeMs);
  const state = controller.readState();
  if (state.playheadMs !== timeMs || state.currentTimes.length === 0 || state.currentTimes.some((currentTime) => currentTime !== timeMs)
    || state.playStates.some((playState) => playState !== 'paused')) {
    shotStatus.value = `PREVIEW_MOMENT_ALIGNMENT_INVALID · revision ${authoring.value.document.revision} unchanged.`; return false;
  }
  scrubber.value = String(timeMs); playhead.value = `${timeMs} ms`; updatePreviewPlaybackState(); schedulePreviewSelection(); return true;
}

export function renderTrack(row: TimelineRow): HTMLElement {
  const article = document.createElement('article');
  article.className = 'track-row';
  Object.assign(article.dataset, {
    trackId: row.trackId, elementId: row.elementId, property: row.property,
    ruleId: row.ruleId, applicationId: row.applicationId, activeSlotId: row.activeSlotId,
    delayMs: String(row.delayMs), slotCount: String(row.orderedSlotIds.length),
    interpolation: row.interpolation, timing: JSON.stringify(row.timing), timingKind: row.timing.kind,
    keyframeCount: String(row.keyframes.length),
    selected: String(row.trackId === selectedTrackId.value),
    cueOwned: String(Boolean(authoring.value.document.tracks.find((track) => track.id === row.trackId)?.cueOwnership)),
  });
  const timing = row.timing.kind === 'steps' ? `steps(${row.timing.count}, ${row.timing.position})`
    : row.timing.kind === 'keyword' ? row.timing.value : 'cubic-bezier';
  const cueOwned = Boolean(authoring.value.document.tracks.find((track) => track.id === row.trackId)?.cueOwnership);
  article.innerHTML = `<div class="track-identity"><strong>${row.property}</strong><span>${row.interpolation} motion${cueOwned ? ' · cue-owned · locked' : ''}</span><details class="canonical-ids"><summary>Canonical IDs</summary><code>Element · ${row.elementId}</code><code>Track · ${row.trackId}</code><code>Rule · ${row.ruleId}</code></details></div><div class="track-meta"><span>delay ${row.delayMs} ms</span><span>${timing}</span><span>${row.orderedSlotIds.length} ordered slot${row.orderedSlotIds.length === 1 ? '' : 's'}</span><div class="slots"></div></div><div class="keyframes"></div>`;
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
    marker.setAttribute('aria-pressed', String(editable && selectedKeyframeId.value === keyframe.id));
    Object.assign(marker.dataset, { keyframeId: keyframe.id, offset: String(keyframe.offset), value: keyframe.value, easing: JSON.stringify(keyframe.easing), timeMs: String(keyframe.timeMs) });
    marker.innerHTML = `<strong>${formatTimelineNumber(keyframe.timeMs, 3)} ms</strong><code>${keyframe.id}</code><span>${formatTimelineNumber(keyframe.offset * 100, 4)}% · ${keyframe.value} · easing ${keyframe.easing ? JSON.stringify(keyframe.easing) : 'inherited'}</span>`;
    marker.addEventListener('click', () => { selectedTrackId.value = row.trackId; selectedKeyframeId.value = keyframe.id; hasExplicitKeyframeSelection.value = true; renderProjection(); valueInput.focus({ preventScroll: true }); });
    keyframeList.append(marker);
  }
  return article;
}

export function formatTimelineNumber(value: number, maximumFractionDigits: number): string {
  const rounded = Number(value.toFixed(maximumFractionDigits));
  return Object.is(rounded, -0) || rounded === 0 ? '0' : String(rounded);
}

export function announceInvalidInput(input: HTMLInputElement, label: string): void {
  input.setAttribute('aria-invalid', 'true');
  status.value = `${label}: ${input.validationMessage} Revision ${authoring.value.document.revision} unchanged.`;
  status.dataset.kind = 'error';
  status.dataset.source = 'validation';
}

export function clearValidationFeedback(input: HTMLInputElement): void {
  input.setAttribute('aria-invalid', String(!input.validity.valid));
  if (input.validity.valid && status.dataset.source === 'validation') {
    status.value = `Revision ${authoring.value.document.revision} ready.`;
    status.dataset.kind = 'ready';
    delete status.dataset.source;
  }
}

export function schedulePreviewSelection(): void {
  requestAnimationFrame(updatePreviewSelection);
}
