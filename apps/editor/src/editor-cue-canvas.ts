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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, updateStructuralControls, hydrateTimingControls, updateTimingDraftState, eligibilityReason, findCreatedTrack, diagnosticMessage, rejectAuthoringInput, successMessage, updateSelection, disableUnavailableMutationControls, findEditableTrack, currentTarget, scrub, stopPlaybackFeedback, syncPlaybackFeedback, startPlaybackFeedback, alignShotPreviewToMoment, renderTrack, formatTimelineNumber, announceInvalidInput, clearValidationFeedback, schedulePreviewSelection, mountPreview, configurePreviewCanvas, readShotProjection, rectValue, updatePreviewSelection, syncPreviewObjectTargets, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export function missingCueTarget(selections: Map<CueCanvasRole, string>): boolean {
  return (['cursor', 'pulse', 'reveal'] as const).some((role) => !selections.get(role));
}

export function initializeCuePathDefaults(selections: Map<CueCanvasRole, string>): void {
  const cursorId = selections.get('cursor'); const pulseId = selections.get('pulse');
  if (!cursorId || !pulseId) return;
  const form = required<HTMLFormElement>('[data-cue-form="cursor-path"]');
  const time = (name: string) => Number((form.elements.namedItem(name) as HTMLInputElement).value);
  const restoreTime = controller.readState().playheadMs; controller.scrub(time('start'));
  const cursor = cueVisualBounds(cursorId); controller.scrub(time('arrive')); const pulse = cueVisualBounds(pulseId);
  controller.scrub(restoreTime);
  if (!cursor || !pulse) return;
  const source = controller.sourceSize();
  const pulseCenter = { x: (pulse.left + pulse.right) / 2, y: (pulse.top + pulse.bottom) / 2 };
  const set = (name: string, value: number) => {
    const input = form.elements.namedItem(name) as HTMLInputElement;
    input.value = String(Math.round(value * 10_000) / 10_000);
  };
  set('startX', cursor.left / source.widthCssPixels * 100);
  set('startY', cursor.top / source.heightCssPixels * 100);
  set('endX', (pulseCenter.x - cursor.width / 2) / source.widthCssPixels * 100);
  set('endY', (pulseCenter.y - cursor.height / 2) / source.heightCssPixels * 100);
  cuePathDefaultsInitialized.value = true;
}

export function renderCueTargetOverlay(selections: Map<CueCanvasRole, string>): void {
  if (!cueTargetOverlay) return;
  cueTargetOverlay!.replaceChildren();
  const entries = authoring.value.document.elements.map((element) => ({ elementId: element.id, bounds: cueVisualBounds(element.id) }))
    .filter((entry): entry is { elementId: string; bounds: ProjectionRect } => Boolean(entry.bounds))
    .sort((left, right) => left.elementId.localeCompare(right.elementId));
  cueTargetOverlay!.dataset.candidateCount = String(entries.length);
  cueTargetOverlay!.onclick = null;
  if (cuePickRole.value) {
    const commit = (elementId: string) => {
      const role = cuePickRole.value; if (!role) return;
      cueRoleSelect(role).value = elementId; cuePickRole.value = null; renderCueCanvas();
      announceCueStatus(`${cueRoleLabel(role)} selected.`, false);
    };
    for (const [index, entry] of entries.entries()) {
      const marker = document.createElement('span'); marker.className = 'cue-target-candidate';
      marker.dataset.cueTargetCandidate = ''; marker.dataset.elementId = entry.elementId;
      marker.dataset.objectLabel = `Object ${index + 1}`;
      Object.assign(marker.style, { left: `${entry.bounds.left}px`, top: `${entry.bounds.top}px`,
        width: `${entry.bounds.width}px`, height: `${entry.bounds.height}px` });
      cueTargetOverlay!.append(marker);
    }
    cueTargetOverlay!.onclick = (event) => {
      if (event.target !== cueTargetOverlay) return;
      const overlayRect = cueTargetOverlay!.getBoundingClientRect();
      const source = controller.sourceSize();
      const x = (event.clientX - overlayRect.left) * source.widthCssPixels / overlayRect.width;
      const y = (event.clientY - overlayRect.top) * source.heightCssPixels / overlayRect.height;
      const hits = entries.filter(({ bounds }) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
      if (hits.length === 1) { commit(hits[0]!.elementId); return; }
      if (hits.length === 0) { announceCueStatus('No selectable object is under that point. Try another visible object.', true); return; }
      for (const marker of cueTargetOverlay!.querySelectorAll<HTMLElement>('[data-cue-target-candidate]')) {
        marker.dataset.ambiguous = String(hits.some((hit) => hit.elementId === marker.dataset.elementId));
      }
      const chooser = document.createElement('div'); chooser.className = 'cue-target-disambiguation';
      chooser.dataset.cueTargetDisambiguation = ''; chooser.setAttribute('role', 'group'); chooser.setAttribute('aria-label', 'Choose the intended overlapping object');
      Object.assign(chooser.style, { left: `${x}px`, top: `${y}px` });
      const heading = document.createElement('strong'); heading.textContent = 'Objects overlap here'; chooser.append(heading);
      for (const hit of hits) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.cueTargetChoice = '';
        button.dataset.elementId = hit.elementId;
        button.textContent = cueTargetOverlay!.querySelector<HTMLElement>(`[data-cue-target-candidate][data-element-id="${hit.elementId}"]`)?.dataset.objectLabel ?? 'Object';
        button.addEventListener('click', (choiceEvent) => { choiceEvent.stopPropagation(); commit(hit.elementId); });
        chooser.append(button);
      }
      cueTargetOverlay!.querySelector('[data-cue-target-disambiguation]')?.remove();
      cueTargetOverlay!.append(chooser); chooser.querySelector<HTMLButtonElement>('button')?.focus();
      announceCueStatus('Several objects overlap there. Choose the intended object from the neutral list.', false);
    };
  } else {
    const rolesByElement = new Map<string, CueCanvasRole[]>();
    for (const [role, elementId] of selections) if (elementId) rolesByElement.set(elementId,
      [...(rolesByElement.get(elementId) ?? []), role]);
    for (const [elementId, roles] of rolesByElement) {
      const entry = entries.find((candidate) => candidate.elementId === elementId); if (!entry) continue;
      const marker = document.createElement('span'); marker.className = 'cue-target-assignment';
      marker.dataset.roles = roles.join(' '); marker.dataset.elementId = elementId;
      marker.dataset.label = roles.map(cueRoleLabel).join(' · ');
      Object.assign(marker.style, { left: `${entry.bounds.left}px`, top: `${entry.bounds.top}px`,
        width: `${entry.bounds.width}px`, height: `${entry.bounds.height}px` });
      cueTargetOverlay!.append(marker);
    }
  }
  cueTargetOverlay!.hidden = cueTargetOverlay!.childElementCount === 0;
  cueTargetOverlay!.dataset.picking = String(Boolean(cuePickRole.value));
}

export async function renderCuePathOverlay(generation: number): Promise<void> {
  if (!cuePathOverlay) return;
  if (controller.readState().playStates.some((playState) => playState === 'running')) return;
  const cue = authoring.value.document.cues.find((candidate): candidate is PathAuthoringCue => candidate.schemaVersion === 'motion.authoring-cue.v1'
    && (candidate.semantic.kind === 'cursor-path' || (reusableCueWorkspace && candidate.semantic.kind === 'drag')));
  cuePathOverlay.replaceChildren();
  if (!cue || cuePickRole.value || reusablePickControl.value) {
    required<HTMLElement>('[data-cue-path-guidance]').textContent = cuePickRole.value || reusablePickControl.value
      ? 'Finish choosing the canvas target to edit the path.'
      : 'Pick the cursor, create its path, then drag Start and Arrive on the canvas.';
    return;
  }
  const restoreTime = controller.readState().playheadMs;
  const pathTargetId = cue.semantic.kind === 'drag' ? cue.semantic.draggedTargetId : cue.semantic.cursorTargetId;
  const samples = cue.semantic.waypoints.map((waypoint) => {
    controller.scrub(waypoint.timeMs); return { timeMs: waypoint.timeMs, bounds: cueVisualBounds(pathTargetId) };
  });
  controller.scrub(restoreTime);
  if (generation !== cueCanvasGeneration.value) return;
  const handles: HTMLButtonElement[] = [];
  for (const [index, waypoint] of cue.semantic.waypoints.entries()) {
    const sample = samples.find((candidate) => candidate.timeMs === waypoint.timeMs);
    if (!sample?.bounds) continue;
    const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'cue-path-waypoint';
    const label = index === 0 ? 'Start' : index === cue.semantic.waypoints.length - 1 ? 'Arrive' : `${waypoint.timeMs} ms`;
    Object.assign(handle.dataset, { waypointIndex: String(index), timeMs: String(waypoint.timeMs), label });
    handle.setAttribute('aria-label', `${label} cursor position; drag to adjust the path`);
    Object.assign(handle.style, { left: `${sample.bounds.left}px`, top: `${sample.bounds.top}px`,
      width: `${sample.bounds.width}px`, height: `${sample.bounds.height}px` });
    handle.addEventListener('click', () => scrub(waypoint.timeMs));
    handle.addEventListener('pointerdown', (event) => beginCuePathDrag(event, cue, index));
    cuePathOverlay.append(handle); handles.push(handle);
  }
  for (let index = 0; index < handles.length - 1; index += 1) cuePathOverlay.prepend(cuePathSegment(handles[index]!, handles[index + 1]!));
  required<HTMLElement>('[data-cue-path-guidance]').textContent = 'Drag Start or Arrive directly on the canvas. Timing stays in the fields below.';
}

export function cueVisualBounds(elementId: string): ProjectionRect | null {
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`); if (!target) return null;
  const candidates = [target, ...target.querySelectorAll<HTMLElement>('*')];
  const rects = candidates.map((candidate) => candidate.getBoundingClientRect())
    .filter((rect) => Number.isFinite(rect.left) && rect.width > 0 && rect.height > 0);
  if (rects.length === 0) {
    let parent = target.parentElement;
    while (parent && parent !== iframe.contentDocument?.body) {
      const rect = parent.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) { rects.push(rect); break; }
      parent = parent.parentElement;
    }
  }
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left)); const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right)); const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function cuePathSegment(from: HTMLElement, to: HTMLElement): HTMLSpanElement {
  const segment = document.createElement('span'); segment.className = 'cue-path-segment'; segment.setAttribute('aria-hidden', 'true');
  segment.dataset.from = from.dataset.waypointIndex ?? ''; segment.dataset.to = to.dataset.waypointIndex ?? '';
  positionCuePathSegment(segment, from, to); return segment;
}

export function positionCuePathSegment(segment: HTMLElement, from: HTMLElement, to: HTMLElement): void {
  const center = (item: HTMLElement) => { const [dx = '0', dy = '0'] = item.style.translate.split(/\s+/);
    return { x: Number.parseFloat(item.style.left) + Number.parseFloat(item.style.width) / 2 + (Number.parseFloat(dx) || 0),
      y: Number.parseFloat(item.style.top) + Number.parseFloat(item.style.height) / 2 + (Number.parseFloat(dy) || 0) }; };
  const start = center(from); const end = center(to); const dx = end.x - start.x; const dy = end.y - start.y;
  Object.assign(segment.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${Math.hypot(dx, dy)}px`,
    transform: `translateY(-1px) rotate(${Math.atan2(dy, dx)}rad)` });
}

export function refreshCuePathSegments(): void {
  if (!cuePathOverlay) return;
  for (const segment of cuePathOverlay.querySelectorAll<HTMLElement>('[data-from]')) {
    const from = cuePathOverlay.querySelector<HTMLElement>(`[data-waypoint-index="${segment.dataset.from}"]`);
    const to = cuePathOverlay.querySelector<HTMLElement>(`[data-waypoint-index="${segment.dataset.to}"]`);
    if (from && to) positionCuePathSegment(segment, from, to);
  }
}

export function beginCuePathDrag(event: PointerEvent, cue: PathAuthoringCue, waypointIndex: number): void {
  if (event.button !== 0) return;
  const projection = readShotProjection(); if (!projection) return;
  const surface = event.currentTarget as HTMLButtonElement; const start = { clientX: event.clientX, clientY: event.clientY };
  const base = cue.semantic.waypoints[waypointIndex]; if (!base) return;
  const envelope = operationEnvelope(); const gesture = ++cuePathGestureGeneration.value;
  const committed = { html: compiled.value.html, css: compiled.value.css }; let latest: { operation: CueAuthoringOperation;
    intent: OperationIntentPayload; html: string; css: string } | null = null;
  let draftTask = Promise.resolve(); let moved = false; event.preventDefault(); surface.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => {
    let delta; try { delta = previewPointerDeltaToPpm(projection, start, { clientX: next.clientX, clientY: next.clientY }); }
    catch { return; }
    moved ||= Math.abs(next.clientX - start.clientX) + Math.abs(next.clientY - start.clientY) > 1; if (!moved) return;
    const semantic = structuredClone(cue.semantic); semantic.waypoints[waypointIndex] = { ...base,
      xPpm: base.xPpm + delta.deltaXPpm, yPpm: base.yPpm + delta.deltaYPpm };
    const operation: CueAuthoringOperation = { ...envelope, kind: 'motion.cue.update', payload: { cueId: cue.id,
      expectedExpansionDigest: cue.expansionDigest, semantic, targetSnapshots: cueTargetSnapshots(authoring.value.document, semantic) } };
    const reduced = dispatchAuthoringOperation(authoring.value, operation); if (!reduced.ok) return;
    let draftCompiled; try { draftCompiled = compileMotionDocument(reduced.state.document); } catch { return; }
    latest = { operation, intent: { kind: 'motion.cue.update', cueId: cue.id, semantic },
      html: draftCompiled.html, css: draftCompiled.css };
    const localDeltaX = delta.deltaXPpm * projection.sourceWidthCssPixels / 1_000_000;
    const localDeltaY = delta.deltaYPpm * projection.sourceHeightCssPixels / 1_000_000;
    surface.style.translate = `${localDeltaX}px ${localDeltaY}px`; refreshCuePathSegments();
    const draft = latest; draftTask = draftTask.then(async () => {
      if (gesture !== cuePathGestureGeneration.value || latest !== draft) return; await controller.applyCompilerCssDraft(draft.css);
    }).catch(() => undefined);
    announceCueStatus('Cursor path draft · release to apply or press Escape to cancel.', false);
  };
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); };
  const restore = () => { cuePathGestureGeneration.value += 1; latest = null; surface.style.translate = ''; refreshCuePathSegments();
    void draftTask.then(() => controller.restoreCommittedCompilerCss()).then(() => { scheduleCueCanvas();
      announceCueStatus(`Cursor path unchanged at revision ${authoring.value.document.revision}.`, false); }); };
  const finish = () => { cleanup(); const accepted = latest; if (!moved || !accepted) { restore(); return; }
    void draftTask.then(async () => {
      if (gesture !== cuePathGestureGeneration.value) return;
      const result = await prepareAndDispatchIntent(accepted.intent, undefined, undefined, { schemaVersion: 'motion.preview-css-commit-promotion.v1',
        oldCommittedHtml: committed.html, oldCompilerCss: committed.css, newCommittedHtml: accepted.html, newCompilerCss: accepted.css });
      if (!result.ok) surface.style.translate = '';
      scheduleCueCanvas();
      announceCueStatus(result.ok ? `Cursor path updated at revision ${authoring.value.document.revision}.` : `Change rejected: ${result.code}.`, !result.ok);
    }); };
  const cancel = () => { cleanup(); restore(); };
  const escape = (keyboard: KeyboardEvent) => { if (keyboard.key !== 'Escape') return; keyboard.preventDefault(); cancel(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', cancel, { once: true }); window.addEventListener('keydown', escape);
}
