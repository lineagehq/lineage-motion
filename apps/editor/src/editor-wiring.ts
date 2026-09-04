import { type AuthoringOperation, type StructuralAuthoringElementId } from '../../../packages/domain/src/index.js';
import { buildTimeline } from '../../../packages/preview-runtime/src/index.js';
import {
  addMidpointButton, announceInvalidInput, authoring, clearValidationFeedback, controller, createTrackButton,
  creationDraftDirty, delayInput, dispatch, durableRedoAvailable, durableUndoAvailable, durationInput,
  easingInput, insertHoldButton, makeEdit, makeHistory, operationEnvelope, previewSelection,
  redoButton, rejectAuthoringInput, removeMidpointButton, republishShotGeometry, required, schedulePreviewSelection,
  scrub, scrubber, selectedCreationElementId, serviceClient, setDelayButton, setDurationButton, setEasingButton,
  shotConfig, startPlaybackFeedback, stopPlaybackFeedback, syncPlaybackFeedback, timeInput, undoButton,
  updateStructuralControls, updateTimingDraftState, valueInput, withCreatedTrack,
} from './main.js';

export function wireAuthoringControls(): void {
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="creation-target"]')) {
  radio.addEventListener('change', () => {
    selectedCreationElementId.value = radio.value as StructuralAuthoringElementId;
    creationDraftDirty.value = true;
    updateStructuralControls(buildTimeline(authoring.value.document).rows);
    schedulePreviewSelection();
  });
}

required<HTMLButtonElement>('[data-play]').addEventListener('click', () => {
  if (!shotConfig.value) previewSelection.hidden = true;
  if (Number(scrubber.value) >= Number(scrubber.max)) scrub(0);
  controller.play();
  startPlaybackFeedback();
  republishShotGeometry();
});
required<HTMLButtonElement>('[data-pause]').addEventListener('click', () => {
  controller.pause();
  stopPlaybackFeedback(); syncPlaybackFeedback();
  republishShotGeometry();
  schedulePreviewSelection();
});
scrubber.addEventListener('input', () => scrub(Number(scrubber.value)));
required<HTMLFormElement>('[data-value-form]').addEventListener('submit', (event) => {
  event.preventDefault(); void dispatch(makeEdit('motion.keyframe-value.set', { value: Number(valueInput.value) }));
});
required<HTMLFormElement>('[data-time-form]').addEventListener('submit', (event) => {
  event.preventDefault(); void dispatch(makeEdit('motion.keyframe-time.set', { timeMs: Number(timeInput.value) }));
});
valueInput.addEventListener('invalid', () => announceInvalidInput(valueInput, 'Opacity value'));
timeInput.addEventListener('invalid', () => announceInvalidInput(timeInput, 'Master time'));
valueInput.addEventListener('input', () => clearValidationFeedback(valueInput));
timeInput.addEventListener('input', () => clearValidationFeedback(timeInput));
valueInput.addEventListener('input', () => { valueInput.dataset.draft = 'true'; });
timeInput.addEventListener('input', () => { timeInput.dataset.draft = 'true'; });
undoButton.addEventListener('click', () => {
  if (serviceClient ? !durableUndoAvailable() : authoring.value.undo.length === 0) return;
  void dispatch(makeHistory('motion.history.undo'), '[data-undo]', {
    viewportTop: undoButton.getBoundingClientRect().top, scrollY,
  });
});
redoButton.addEventListener('click', () => {
  if (serviceClient ? !durableRedoAvailable() : authoring.value.redo.length === 0) return;
  void dispatch(makeHistory('motion.history.redo'), '[data-redo]', {
    viewportTop: redoButton.getBoundingClientRect().top, scrollY,
  });
});
createTrackButton.addEventListener('click', () => {
  if (!selectedCreationElementId.value) return;
  const elementId = selectedCreationElementId.value;
  void dispatch({
  ...operationEnvelope(), kind: 'motion.track.create', elementId,
  payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 },
  } as AuthoringOperation, '[data-add-midpoint]');
});
addMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.add', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { timeMs: 1110, value: 0.5 },
}), '[data-value]'));
setDurationButton.addEventListener('click', () => {
  const durationMs = Number(durationInput.value);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return rejectAuthoringInput(durationInput,
    'AUTHORING_DURATION_INVALID');
  void withCreatedTrack((track) => ({ ...operationEnvelope(), kind: 'motion.slot-duration.set',
    elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId, payload: { durationMs } }));
});
setDelayButton.addEventListener('click', () => {
  const delayMs = Number(delayInput.value);
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) return rejectAuthoringInput(delayInput,
    'AUTHORING_DELAY_INVALID');
  void withCreatedTrack((track) => ({ ...operationEnvelope(), kind: 'motion.binding-delay.set',
    elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId, payload: { delayMs } }));
});
setEasingButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.slot-easing.set', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  payload: { easing: required<HTMLSelectElement>('[data-easing]').value as 'linear' | 'ease-in-out' },
})));
insertHoldButton.addEventListener('click', () => void dispatch({
  ...operationEnvelope(), kind: 'motion.hold.insert',
  payload: { cueId: 'cue_pair', durationMs: 600 },
}, '[data-undo]'));
removeMidpointButton.addEventListener('click', () => void withCreatedTrack((track) => ({
  ...operationEnvelope(), kind: 'motion.keyframe.remove', elementId: track.elementId as StructuralAuthoringElementId, trackId: track.trackId,
  keyframeId: track.keyframes.find((keyframe) => keyframe.offset === 0.5)?.id ?? '',
}), '[data-add-midpoint]'));
for (const [selector, label] of [['[data-duration]', 'Duration'], ['[data-delay]', 'Delay']] as const) {
  const input = required<HTMLInputElement>(selector);
  input.addEventListener('invalid', () => announceInvalidInput(input, label));
  input.addEventListener('input', () => clearValidationFeedback(input));
}
for (const control of [durationInput, delayInput, easingInput]) {
  control.addEventListener('input', () => updateTimingDraftState(control));
  control.addEventListener('change', () => updateTimingDraftState(control));
}
}
