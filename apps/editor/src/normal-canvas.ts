import { displayTime } from './editor-time.js';
import { projectShotWorkspace, projectTransformTrajectory } from '../../../packages/domain/src/index.js';
import { authoring, openShotWorkspace, publicationState, pendingRevision, captureDraft,
  configurePreviewCanvas, schedulePreviewSelection, renderShotWorkspace, shotConfig } from './main.js';
import './canvas-clarity.css';

// Discover from the loaded document: no starter IDs or assumed timing boundaries.
function canvasConfig() {
  const document = authoring.value.document;
  const trajectories = document.elements.map(element => projectTransformTrajectory(document, element.id))
    .filter(trajectory => trajectory.eligible);
  if (!trajectories.length) return null;
  const times = trajectories[0]!.waypoints.map(point => point.timeMs)
    .filter(time => trajectories.every(trajectory => trajectory.waypoints.some(point => point.timeMs === time)));
  if (times.length < 3) return null;
  const config = { startMs: times[0]!, landedMs: times[1]!, settledMs: times.at(-1)!,
    targetElementIds: trajectories.map(trajectory => trajectory.elementId) };
  return projectShotWorkspace(document, config).eligible ? config : null;
}

export function mountNormalCanvas(root: HTMLElement): void {
  root.classList.add('normal-editor');
  const playhead = root.querySelector<HTMLOutputElement>('[data-playhead]')!;
  const scrubber = root.querySelector<HTMLInputElement>('[data-scrub]')!;
  playhead.value = displayTime(Number(scrubber.value));
  const panel = root.querySelector<HTMLElement>('.preview-panel')!;
  const entry = document.createElement('div'); entry.className = 'canvas-entry';
  entry.innerHTML = '<button type="button" data-open-canvas>Edit motion on canvas</button><p data-canvas-availability></p><output data-save-status role="status" aria-live="polite"></output>';
  panel.prepend(entry);
  const button = entry.querySelector<HTMLButtonElement>('button')!;
  const availability = entry.querySelector<HTMLElement>('[data-canvas-availability]')!;
  const saved = entry.querySelector<HTMLOutputElement>('[data-save-status]')!;
  const exact = document.createElement('details'); exact.className = 'exact-track-controls'; exact.open = true;
  exact.innerHTML = '<summary>Exact track controls</summary>';
  const workflow = root.querySelector<HTMLElement>('.workflow')!;
  for (const card of workflow.querySelectorAll(':scope > .workflow-card')) exact.append(card);
  workflow.append(exact);
  const reduced = root.querySelector<HTMLElement>('[data-reduced-toggle]')!;
  const reducedPanel = root.querySelector<HTMLElement>('[data-reduced-motion-panel]')!;
  const reducedHost = document.createElement('div'); reducedHost.className = 'canvas-reduced';
  reducedHost.append(reduced, reducedPanel); panel.append(reducedHost);
  const dirty = () => captureDraft().dirty || Boolean(root.querySelector('[data-project-draft="true"]'));
  const pending = () => publicationState.value === 'pending' || pendingRevision.value !== null
    || Boolean(root.querySelector('[data-operation-pending="true"]'));
  let invalid = false;
  const refresh = () => {
    const config = canvasConfig(); button.hidden = Boolean(shotConfig.value);
    button.disabled = !config || pending() || dirty();
    availability.textContent = shotConfig.value ? 'Choose an object and moment. Each completed gesture saves one change.'
      : config ? 'Edit existing position, scale, rotation and moments directly.'
      : 'Canvas editing needs compatible transform animation with three shared moments. Use the object actions or exact tracks for this shot.';
    const failed = publicationState.value === 'failed' || invalid
      || Boolean(root.querySelector('[data-shot-control-feedback]:not([hidden])'))
      || root.querySelector<HTMLElement>('[data-operation-status]')?.dataset.kind === 'error';
    const conflict = Boolean(root.querySelector('[data-draft-conflict]:not([hidden])'));
    const state = pending() ? 'pending' : conflict ? 'conflict' : failed ? 'rejected' : dirty() ? 'draft' : 'saved';
    saved.dataset.state = state;
    saved.value = state === 'pending' ? 'Saving… Previous saved preview remains active.'
      : state === 'conflict' ? 'The saved animation changed. Your draft is still here; choose how to resolve it.'
      : state === 'rejected' ? 'Change not applied. Your saved animation is safe; review your draft and try again.'
      : state === 'draft' ? 'Unsaved draft. Apply the change when ready.' : `Saved locally · revision ${authoring.value.document.revision}`;
  };
  button.addEventListener('click', () => {
    if (pending() || dirty()) return;
    const config = canvasConfig(); if (!config) return;
    if (openShotWorkspace(config).ok) {
      exact.open = false;
      root.querySelector<HTMLElement>('[data-shot-object-bar] input')?.focus();
      configurePreviewCanvas(); renderShotWorkspace();
    }
    refresh();
  });
  root.addEventListener('invalid', () => { invalid = true; refresh(); }, true);
  root.addEventListener('input', () => { invalid = false; queueMicrotask(refresh); });
  root.addEventListener('change', () => queueMicrotask(refresh));
  document.addEventListener('motion:projection', () => { invalid = false; refresh(); });
  document.addEventListener('motion:feedback', refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(root, { subtree: true, attributes: true,
    attributeFilter: ['data-publication-state', 'data-operation-pending', 'data-project-draft', 'data-kind'] });
  for (const feedback of root.querySelectorAll('[data-draft-conflict], [data-shot-control-feedback]'))
    observer.observe(feedback, { attributes: true, attributeFilter: ['hidden'] });
  exact.addEventListener('toggle', () => { configurePreviewCanvas(); schedulePreviewSelection(); });
  refresh(); configurePreviewCanvas();
}
