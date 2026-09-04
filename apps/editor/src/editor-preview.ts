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
import { authoring, compiled, serviceClient, lastCommit, immutableRefetchCount, pendingRevision, publicationState, publicationFailureCode, activeBranchId, durableWorkspace, durableBranches, durableClaims, durableActivity, lastServiceDiagnostic, publicationTestGate, failNextPublicationForTest, operationClientId, operationSequence, creationChoices, statusCopyElementId, selectedCreationElementId, creationDraftDirty, selectedTrackId, selectedKeyframeId, hasExplicitKeyframeSelection, unavailableSelection, unavailableCreation, lastCommitSeq, reconciliation, branchGeneration, eventSubscription, eventSubscriptionGeneration, reconciliationFailures, reconnectTimer, draftConflictRevision, draftStaleBaseRevision, detachedCueKinds, cuePathDefaultsInitialized, reusableCueWorkspace, reusableTargetOptions, reusableTextTargetOptions, reusableHoldTargetOptions, iframe, controller, reviewHandoff, scrubber, playhead, status, valueInput, timeInput, valueButton, timeButton, undoButton, redoButton, createTrackButton, addMidpointButton, removeMidpointButton, durationInput, delayInput, easingInput, setDurationButton, setDelayButton, setEasingButton, previewStage, previewCanvas, previewObjectOverlay, previewSelection, previewShotToolbar, previewShotObject, previewShotState, previewShotActions, branchSelect, branchForm, revokeForm, draftConflict, shotWorkspace, shotTargets, shotMoments, shotOverlay, shotPoseForm, shotAdvancedToggle, shotAdvancedDrawer, shotStatus, shotControlFeedback, shotGuidance, shotRecovery, cueWorkspace, cueTargetOverlay, cuePathOverlay, cuePickRole, reusablePickControl, cueEditingKind, cueCanvasGeneration, cueCanvasFrame, cuePathGestureGeneration, shotConfig, shotSelection, shotPrimaryElementId, shotMomentMs, shotMode, shotProjection, shotGeometry, shotGeometryGeneration, shotGeometryRequestId, latestShotGeometryRequest, pendingShotGeometryRequest, shotGeometryPumpRunning, shotGeometryPumpCompletion, activeShotGeometrySamplers, maximumActiveShotGeometrySamplers, lastCommittedShotGeometryRequestId, committedShotGeometryKey, mountedPreviewGeneration, activeWaypointDraft, waypointDraftApply, waypointDraftFrame, waypointDraftMoveCount, waypointDraftAppliedCount, waypointDraftFailure, waypointGestureGeneration, waypointReleasePhase, playbackFeedbackFrame, lastPreviewCommitPromotion, setShotAdvancedOpen, shotMomentTime, previewSelectionLabel, appliedDuration, appliedDelay, appliedEasing, insertHoldButton, holdStatus, reducedToggle, reducedPanel, inspectShotWorkspace, setPublicationState, clearShotControlFeedback, showShotControlFailure, publishServiceDiagnostic, publishClientDiagnostic, renderProjection, openShotWorkspace, activateShotLayout, mountShotAdvancedSurfaces, forEachShotControl, initializeSeedWorkspace, showSeedWorkspaceFailure, canonicalShotInventory, isSharedShotMoment, selectShotPrimary, selectShotMode, selectShotMoment, focusShotMoment, shotMomentLabel, updatePreviewPlaybackState, syncPreviewShotToolbar, renderShotWorkspace, renderShotContextDock, publishShotGeometry, republishShotGeometry, isCurrentShotGeometryRequest, pumpShotGeometry, awaitShotGeometryCommit, refreshTrajectorySegments, syncReferencePathSelection, renderReferencePaths, processShotGeometryRequest, shotStageProjection, shotViewportIntent, directPoseIntent, selectedShotPose, normalizeRotation, directPoseOperation, beginDirectPoseGesture, handleDirectPoseKeyboard, applyShotPose, buildWaypointTranslateOperation, beginWaypointDrag, addShotMoment, removeShotMoment, applyShotMomentTime, effectiveShotTimings, applyShotEasing, applyShotHold, required } from './main.js';
import type { PublicationState, DurableWorkspace, DurableBranches, DurableClaims, DurableActivity, DurableContextSnapshot, CueCanvasRole, CursorPathAuthoringCue, PathAuthoringCue, ShotGeometryRequest, EditorPersistentOperation, ShotControlAction, DraftSnapshot, DirectPoseKind, ShotPose } from './main.js';

export async function mountPreview(compiledHtml: string, compilerCss: string): Promise<void> {
  if (shotGeometryPumpRunning.value) await shotGeometryPumpCompletion.value;
  await controller.mount(compiledHtml, compilerCss);
  mountedPreviewGeneration.value += 1;
  const requestedPlayheadMs = Number(scrubber.value);
  const mountedState = controller.readState();
  if (Number.isFinite(requestedPlayheadMs) && requestedPlayheadMs >= 0
    && (mountedState.playheadMs !== requestedPlayheadMs || mountedState.currentTimes.some((time) => time !== requestedPlayheadMs))) {
    controller.scrub(requestedPlayheadMs); playhead.value = `${requestedPlayheadMs} ms`;
  }
  configurePreviewCanvas();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (shotConfig.value) renderShotWorkspace();
  scheduleCueCanvas();
}

export function configurePreviewCanvas(): void {
  const source = controller.sourceSize(); const availableWidth = previewStage.clientWidth;
  if (!Number.isSafeInteger(source.widthCssPixels) || source.widthCssPixels <= 0
    || !Number.isSafeInteger(source.heightCssPixels) || source.heightCssPixels <= 0) throw new Error('PREVIEW_SOURCE_SIZE_INVALID');
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) throw new Error('PREVIEW_PROJECTION_INVALID');
  const runway = shotConfig.value ? 72 : 0;
  const previewPanel = required<HTMLElement>('.preview-panel');
  const panelTop = previewPanel.getBoundingClientRect().top;
  const chromeHeight = required<HTMLElement>('.preview-title').offsetHeight + (shotConfig.value
    ? required<HTMLElement>('[data-shot-object-bar]').offsetHeight
      + required<HTMLElement>('[data-shot-context-dock]').offsetHeight
      + required<HTMLElement>('[data-preview-control-rail]').offsetHeight
      + required<HTMLElement>('[data-shot-history-slot]').offsetHeight
    : required<HTMLElement>('.transport').offsetHeight);
  const visiblePanelTop = getComputedStyle(previewPanel).position === 'static' || panelTop >= window.innerHeight ? 0 : Math.max(0, panelTop);
  const availableHeight = Math.max(240, window.innerHeight - visiblePanelTop - chromeHeight - 48);
  const scale = Math.min((availableWidth - runway * 2) / source.widthCssPixels,
    (availableHeight - runway * 2) / source.heightCssPixels);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('PREVIEW_PROJECTION_INVALID');
  previewCanvas.style.width = `${source.widthCssPixels}px`; previewCanvas.style.height = `${source.heightCssPixels}px`;
  previewCanvas.style.left = `${runway}px`; previewCanvas.style.top = `${runway}px`;
  previewCanvas.style.transform = `scale(${scale})`; previewStage.style.height = `${source.heightCssPixels * scale + runway * 2}px`;
  previewStage.dataset.runwayCssPixels = String(runway);
  iframe.style.width = `${source.widthCssPixels}px`; iframe.style.height = `${source.heightCssPixels}px`;
}

export function readShotProjection(): PreviewOverlayProjection | null {
  const source = controller.sourceSize();
  const result = createPreviewOverlayProjection({ sourceWidthCssPixels: source.widthCssPixels,
    sourceHeightCssPixels: source.heightCssPixels, iframeRect: rectValue(iframe.getBoundingClientRect()),
    overlayRect: rectValue(shotOverlay.getBoundingClientRect()), devicePixelRatio: window.devicePixelRatio });
  if (!result.ok) { shotStatus.value = `${result.code} · revision ${authoring.value.document.revision} unchanged.`; return null; }
  return result.projection;
}

export function rectValue(rect: DOMRect): ProjectionRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

export function updatePreviewSelection(): void {
  syncPreviewObjectTargets();
  const selectedRow = selectedTrackId.value
    ? buildTimeline(authoring.value.document).rows.find((row) => row.trackId === selectedTrackId.value) : undefined;
  const targetElementId = shotConfig.value && shotPrimaryElementId.value ? shotPrimaryElementId.value : selectedCreationElementId.value ?? selectedRow?.elementId;
  if (!targetElementId) {
    previewSelection.hidden = true;
    return;
  }
  const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${targetElementId}"]`);
  if (!target) {
    previewSelection.hidden = true;
    return;
  }
  const targetRect = target.getBoundingClientRect();
  previewSelection.style.left = `${targetRect.left}px`;
  previewSelection.style.top = `${targetRect.top}px`;
  previewSelection.style.width = `${targetRect.width}px`;
  previewSelection.style.height = `${targetRect.height}px`;
  if (shotConfig.value && shotPrimaryElementId.value) {
    previewSelection.querySelector('span')!.textContent = `Object ${shotConfig.value.targetElementIds.indexOf(shotPrimaryElementId.value) + 1}`;
  }
  previewSelection.hidden = false;
}

export function syncPreviewObjectTargets(): void {
  if (!shotConfig.value) {
    previewObjectOverlay.replaceChildren();
    previewObjectOverlay.hidden = true;
    return;
  }
  previewObjectOverlay.hidden = false;
  const existing = new Map([...previewObjectOverlay.querySelectorAll<HTMLButtonElement>('[data-preview-control-key]')]
    .map((button) => [button.dataset.previewControlKey!, button]));
  const desired = new Set<string>();
  const source = controller.sourceSize();
  const displayScale = iframe.getBoundingClientRect().width / source.widthCssPixels;
  const targetSize = Number.isFinite(displayScale) && displayScale > 0 ? 44 / displayScale : 44;
  for (const [index, elementId] of shotConfig.value.targetElementIds.entries()) {
    const target = iframe.contentDocument?.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`);
    const bodyKey = `${elementId}:body`; desired.add(bodyKey);
    let button = existing.get(bodyKey);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'preview-object-target';
      button.dataset.previewControlKey = bodyKey;
      button.dataset.previewObjectId = elementId;
      button.addEventListener('click', () => {
        if (button!.dataset.dragged === 'true') return;
        selectShotPrimary(elementId);
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (shotPrimaryElementId.value !== elementId) selectShotPrimary(elementId);
        beginDirectPoseGesture(event, 'move');
      });
      button.addEventListener('keydown', (event) => void handleDirectPoseKeyboard(event, 'body'));
      previewObjectOverlay.append(button);
    }
    button.setAttribute('aria-label', `Object ${index + 1}; drag to move`);
    button.setAttribute('aria-pressed', String(elementId === shotPrimaryElementId.value));
    button.dataset.objectLabel = `Object ${index + 1}`;
    button.hidden = !target;
    if (target) {
      const rect = target.getBoundingClientRect();
      const bodyWidth = Math.max(rect.width, targetSize); const bodyHeight = Math.max(rect.height, targetSize);
      button.style.left = `${rect.left + rect.width / 2 - bodyWidth / 2}px`;
      button.style.top = `${rect.top + rect.height / 2 - bodyHeight / 2}px`;
      button.style.width = `${bodyWidth}px`; button.style.height = `${bodyHeight}px`;
      const transformControls = [
        { kind: 'scale' as const, corner: 'top-left', x: rect.left - targetSize / 2, y: rect.top - targetSize / 2 },
        { kind: 'scale' as const, corner: 'top-right', x: rect.right + targetSize / 2, y: rect.top - targetSize / 2 },
        { kind: 'scale' as const, corner: 'bottom-right', x: rect.right + targetSize / 2, y: rect.bottom + targetSize / 2 },
        { kind: 'scale' as const, corner: 'bottom-left', x: rect.left - targetSize / 2, y: rect.bottom + targetSize / 2 },
        { kind: 'rotate' as const, corner: null, x: rect.left + rect.width / 2, y: rect.top - targetSize * .82 },
      ];
      for (const control of transformControls) {
        const { kind, corner } = control;
        const key = `${elementId}:${kind}:${corner ?? 'top-center'}`; desired.add(key); let handle = existing.get(key);
        if (!handle) {
          handle = document.createElement('button'); handle.type = 'button';
          handle.className = `preview-transform-handle ${kind}-handle`; handle.dataset.previewControlKey = key;
          handle.dataset.transformElementId = elementId; handle.dataset.transformHandle = kind;
          handle.setAttribute('role', 'slider'); handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return; if (shotPrimaryElementId.value !== elementId) selectShotPrimary(elementId);
            beginDirectPoseGesture(event, kind);
          });
          handle.addEventListener('keydown', (event) => void handleDirectPoseKeyboard(event, kind));
          previewObjectOverlay.append(handle);
        }
        handle.dataset.transformRole = kind === 'scale' ? 'uniform-scale-corner' : 'rotation';
        if (corner) handle.dataset.transformCorner = corner;
        else delete handle.dataset.transformCorner;
        const selected = elementId === shotPrimaryElementId.value; handle.hidden = !selected;
        handle.style.width = `${targetSize}px`; handle.style.height = `${targetSize}px`;
        handle.style.left = `${control.x - targetSize / 2}px`;
        handle.style.top = `${control.y - targetSize / 2}px`;
        const trajectory = projectTransformTrajectory(authoring.value.document, elementId);
        const pose = trajectory.eligible ? trajectory.waypoints.find((point) => point.timeMs === shotMomentMs.value)?.pose : undefined;
        const value = kind === 'scale' ? (pose?.scalePpm ?? 1_000_000) / 1_000_000 : (pose?.rotateMicrodegrees ?? 0) / 1_000_000;
        const controlName = kind === 'scale'
          ? `${corner!.replace('-', ' ')} uniform scale handle for Object ${index + 1}`
          : `Rotation handle for Object ${index + 1}`;
        handle.setAttribute('aria-label', controlName);
        handle.title = kind === 'scale' ? `Drag the ${corner!.replace('-', ' ')} corner to scale Object ${index + 1}`
          : `Drag to rotate Object ${index + 1}`;
        handle.setAttribute('aria-valuemin', kind === 'scale' ? '0.25' : '-180'); handle.setAttribute('aria-valuemax', kind === 'scale' ? '3' : '180');
        handle.setAttribute('aria-valuenow', String(value)); handle.setAttribute('aria-valuetext', kind === 'scale' ? `${value} uniform scale` : `${value} degrees`);
      }
    }
  }
  for (const [key, button] of existing) if (!desired.has(key)) button.remove();
}
