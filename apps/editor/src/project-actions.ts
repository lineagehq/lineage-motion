import { applyCueOperation } from '../../../packages/domain/src/cue-operations.js';
import { projectAuthoringTargets, projectCueActionEligibility, projectHoldEligibility, type AuthoringAction } from '../../../packages/domain/src/authoring-eligibility.js';
import { cueTargetSnapshots, validateMotionDocument, type AuthoringCue, type CueSemantic } from '../../../packages/domain/src/index.js';
import { authoring, dispatch, operationEnvelope, prepareAndDispatchIntent, selectedCreationElementId,
  schedulePreviewSelection, publicationState, activeBranchId } from './main.js';

import { renderActionHistory, retimeSemantic, semanticBounds } from './project-action-history.js';

const labels: Record<AuthoringAction, string> = { move: 'Move', fade: 'Fade', reveal: 'Reveal', type: 'Type', hold: 'Hold selected object', click: 'Click', select: 'Select', drag: 'Drag' };
const help: Record<string, string> = {
  CUE_TEXT_TARGET_REQUIRED: 'Choose an object containing editable text.',
  CUE_SECOND_TARGET_REQUIRED: 'This action needs a second object.',
  CUE_HOLD_TARGET_UNANIMATED: 'Animate this object before adding an object hold.',
  AUTHORING_HOLD_LOCKED: 'Undo the whole-shot pause before editing individual actions.',
  AUTHORING_HOLD_ATTACHED_CUES_UNSUPPORTED: 'Whole-shot pauses require source animation boundaries. Use Hold selected object for authored actions.',
  CUE_REPLACEMENT_INVALID: 'This action cannot replace the current animation. Edit or detach an existing action, or choose another object.',
  TRACK_ALREADY_EXISTS: 'This object already has an opacity animation. Edit its track or use Reveal.',
  AUTHORING_HOLD_CUE_MISSING: 'This shot has no source cue at which to pause. Use Hold selected object at an animation keyframe.',
  ALREADY_ANIMATED: 'This object already has an opacity animation. Edit its track or use Reveal.',
};
function explanation(code: string | null): string { return code ? help[code] ?? `Unavailable for this object: ${code.replaceAll('_', ' ').toLowerCase()}.` : 'Ready'; }

export function mountProjectActions(root: HTMLElement): void {
  const host = document.createElement('section'); host.className = 'project-actions'; host.setAttribute('aria-label', 'Shot actions');
  const end = Math.max(2, Math.floor(authoring.value.document.durationMs / 2));
  host.innerHTML = `<h2>Animate an object</h2><label>Object<select data-action-target></select></label>
    <div data-action-buttons class="action-buttons"></div>
    <form data-action-form><h3 data-action-heading>Choose an action</h3>
      <p data-action-explanation role="status"></p><div class="action-fields">
      <label>Start (ms)<input name="start" type="number" min="0" step="1" value="0" required></label>
      <label>Complete (ms)<input name="end" type="number" min="1" step="1" value="${end}" required></label>
      <label data-peer-field hidden>Second object<select name="peer"></select></label>
      <label data-move-field hidden>Start X (%)<input name="fromX" type="number" step="0.01" value="0"></label>
      <label data-move-field hidden>Start Y (%)<input name="fromY" type="number" step="0.01" value="0"></label>
      <label data-move-field hidden>End X (%)<input name="toX" type="number" step="0.01" value="25"></label>
      <label data-move-field hidden>End Y (%)<input name="toY" type="number" step="0.01" value="0"></label>
      <label data-type-field hidden>Text steps<input name="steps" type="number" min="1" step="1" value="1"></label>
      </div><p data-hold-hint hidden>The start must match an existing animation keyframe. Complete sets the end of the hold.</p>
      <button type="submit" data-apply-action disabled>Apply action</button><button type="button" data-discard-action>Discard action draft</button>
    </form>
    <details class="whole-pause"><summary>Pause the whole shot</summary><p>Freeze every active source animation at a chosen cue and shift later motion together.</p>
      <form data-whole-pause><label>Pause at<select name="cue"></select></label><label>Pause duration (ms)<input name="duration" type="number" min="1" step="1" value="300" required></label>
      <p data-pause-reason></p><button type="submit">Insert whole-shot pause</button><button type="button" data-discard-pause>Discard pause draft</button></form>
    </details><section aria-label="Created actions"><h3>Created actions</h3><div data-project-action-history></div></section><output data-action-status role="status" aria-live="polite"></output>`;
  root.querySelector('.workflow')!.prepend(host);
  // The original opacity controls remain available for detailed track editing.
  root.querySelector<HTMLElement>('[data-hold-control]')!.hidden = true;
  root.querySelector<HTMLElement>('[data-status-copy]')!.hidden = true;
  root.querySelector('h1')!.textContent = 'Shape your shot';
  root.querySelector('.purpose')!.textContent = 'Choose an object and an action, then preview its animation. Add another shot whenever you are ready.';
  const target = host.querySelector<HTMLSelectElement>('[data-action-target]')!;
  const form = host.querySelector<HTMLFormElement>('[data-action-form]')!;
  const peer = form.elements.namedItem('peer') as HTMLSelectElement;
  const pause = host.querySelector<HTMLFormElement>('[data-whole-pause]')!;
  const cue = pause.elements.namedItem('cue') as HTMLSelectElement;
  const feedback = host.querySelector<HTMLOutputElement>('[data-action-status]')!; feedback.tabIndex = -1;
  let selected: AuthoringAction | null = null; let busy = false; let editing: AuthoringCue | null = null; let lastTarget = '';
  const markDraft = (current: HTMLFormElement) => {
    if (current.dataset.projectDraft !== 'true') { current.dataset.baseRevision = String(authoring.value.document.revision); current.dataset.baseBranch = activeBranchId.value; }
    current.dataset.projectDraft = 'true';
  };
  const stale = (current: HTMLFormElement) => current.dataset.projectDraft === 'true' && (
    current.dataset.baseRevision !== String(authoring.value.document.revision) || current.dataset.baseBranch !== activeBranchId.value);
  const number = (name: string) => Number((form.elements.namedItem(name) as HTMLInputElement).value);
  const semantic = (): CueSemantic => {
    const start = number('start'); const end = number('end'); const unit = Math.max(1, Math.floor((end - start) / 4));
    if (editing) {
      const value = retimeSemantic(editing.semantic, start, end);
      if (value.kind === 'type') value.stepCount = number('steps');
      if (value.kind === 'cursor-path' || value.kind === 'drag') {
        value.waypoints[0] = { ...value.waypoints[0]!, xPpm: Math.round(number('fromX') * 10000), yPpm: Math.round(number('fromY') * 10000) };
        value.waypoints[value.waypoints.length - 1] = { ...value.waypoints.at(-1)!, xPpm: Math.round(number('toX') * 10000), yPpm: Math.round(number('toY') * 10000) };
      }
      return value;
    }
    const path = (first: number, last: number) => [{ timeMs: first, xPpm: Math.round(number('fromX') * 10000), yPpm: Math.round(number('fromY') * 10000) },
      { timeMs: last, xPpm: Math.round(number('toX') * 10000), yPpm: Math.round(number('toY') * 10000) }];
    switch (selected) {
      case 'move': return { kind: 'cursor-path', cursorTargetId: target.value, startMs: start, arriveMs: end,
        easing: { kind: 'keyword', value: 'linear' }, waypoints: path(start, end) };
      case 'reveal': return { kind: 'reveal', targetIds: [target.value], startMs: start, completeMs: end };
      case 'type': return { kind: 'type', targetId: target.value, startMs: start, completeMs: end, stepCount: number('steps') };
      case 'hold': return { kind: 'hold', targetIds: [target.value], enterMs: start, durationMs: end - start, exitMs: end };
      case 'click': return { kind: 'click', cursorTargetId: target.value, pulseTargetId: peer.value,
        arriveMs: start, pressMs: start + unit, releaseMs: start + 2 * unit, pulseEndMs: end,
        pressScalePpm: 900000, pulseRadiusPpm: 100000, pulseOpacityPpm: 500000 };
      case 'select': return { kind: 'select', cursorTargetId: target.value, selectedTargetId: peer.value,
        approachMs: start, chooseMs: start + unit, settleMs: end };
      case 'drag': return { kind: 'drag', cursorTargetId: target.value, draggedTargetId: peer.value,
        approachMs: start, pressMs: start + unit, moveStartMs: start + 2 * unit, arriveMs: start + 3 * unit, releaseMs: end,
        grabOffsetXPpm: 0, grabOffsetYPpm: 0, waypoints: path(start + 2 * unit, start + 3 * unit) };
      default: throw new Error('Choose an action');
    }
  };
  const updateValidity = () => {
    for (const current of [form, pause]) for (const input of current.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) input.disabled = busy;
    target.disabled = busy || Boolean(editing);
    host.querySelector<HTMLButtonElement>('[data-discard-action]')!.disabled = busy;
    host.querySelector<HTMLButtonElement>('[data-discard-pause]')!.disabled = busy;
    const data = projectAuthoringTargets(authoring.value.document).find(item => item.elementId === target.value);
    let eligibility = data?.actions.find(item => item.action === selected);
    if (selected && selected !== 'fade') {
      if (editing) { const value = semantic(); const result = applyCueOperation(authoring.value.document, {
          schemaVersion: 'motion.operation.v1', operationId: 'editor-preview-update', documentId: authoring.value.document.documentId,
          expectedRevision: authoring.value.document.revision, kind: 'motion.cue.update', payload: { cueId: editing.id,
            expectedExpansionDigest: editing.expansionDigest, semantic: value, targetSnapshots: cueTargetSnapshots(authoring.value.document, value) } });
        eligibility = { action: selected, available: result.ok && validateMotionDocument(result.document).ok, reason: result.ok ? null : result.code };
      } else eligibility = { action: selected, ...projectCueActionEligibility(authoring.value.document, semantic()) };
    }
    const valid = Number.isSafeInteger(number('start')) && Number.isSafeInteger(number('end')) && number('end') > number('start');
    form.querySelector<HTMLButtonElement>('[data-apply-action]')!.disabled = busy || publicationState.value !== 'settled' || !eligibility?.available || !valid || stale(form);
    form.querySelector('[data-action-explanation]')!.textContent = !selected ? 'Choose what this object should do.'
      : stale(form) ? 'The saved shot changed while you were drafting. Discard this action draft and review the latest shot before trying again.'
      : !valid ? 'Complete must be later than Start, using whole milliseconds.' : explanation(eligibility?.reason ?? null);
    const duration = Number((pause.elements.namedItem('duration') as HTMLInputElement).value);
    const pauseEligibility = projectHoldEligibility(authoring.value.document, cue.value, duration);
    pause.querySelector('button')!.disabled = busy || publicationState.value !== 'settled' || !pauseEligibility.available || stale(pause);
    pause.querySelector('[data-pause-reason]')!.textContent = stale(pause) ? 'The shot changed. Discard this pause draft before choosing a new boundary.' : explanation(pauseEligibility.reason);
  };
  const render = () => {
    if (editing && form.dataset.projectDraft !== 'true' && !authoring.value.document.cues.some(cue => cue.id === editing!.id)) { editing = null; selected = null; form.dataset.projectDraft = 'false'; }
    const items = projectAuthoringTargets(authoring.value.document); const previous = target.value;
    target.replaceChildren(...items.map(item => new Option(item.label, item.elementId))); target.value = items.some(item => item.elementId === previous) ? previous : items[0]?.elementId ?? '';
    lastTarget = target.value;
    const oldPeer = peer.value; peer.replaceChildren(...items.filter(item => item.elementId !== target.value).map(item => new Option(item.label, item.elementId)));
    if ([...peer.options].some(option => option.value === oldPeer)) peer.value = oldPeer;
    const actionList = items.find(item => item.elementId === target.value)?.actions ?? [];
    host.querySelector('[data-action-buttons]')!.replaceChildren(...actionList.map(action => {
      const wrapper = document.createElement('div'); const button = document.createElement('button');
      button.type = 'button'; button.textContent = labels[action.action]; button.disabled = !action.available || busy;
      button.setAttribute('aria-pressed', String(selected === action.action));
      const reason = document.createElement('small'); reason.textContent = action.available ? '' : explanation(action.reason);
      button.addEventListener('click', () => {
        if (form.dataset.projectDraft === 'true' && selected !== action.action) { feedback.value = 'Apply or discard the current action draft before choosing another action.'; return; }
        markDraft(form); editing = null; target.disabled = false; selected = action.action; form.querySelector('[data-apply-action]')!.textContent = 'Apply action'; form.querySelector('[data-action-heading]')!.textContent = labels[selected];
        host.querySelectorAll<HTMLElement>('[data-move-field]').forEach(node => { node.hidden = selected !== 'move' && selected !== 'drag'; });
        host.querySelector<HTMLElement>('[data-peer-field]')!.hidden = !['click', 'select', 'drag'].includes(selected);
        host.querySelector<HTMLElement>('[data-type-field]')!.hidden = selected !== 'type';
        host.querySelector<HTMLElement>('[data-hold-hint]')!.hidden = selected !== 'hold';
        const text = authoring.value.document.elements.find(element => element.id === target.value)?.editableText;
        if (selected === 'type') (form.elements.namedItem('steps') as HTMLInputElement).value = String(Math.max(1, Array.from(text ?? '').length));
        if (selected === 'hold') selectHoldBoundary();
        if (['click', 'select', 'drag'].includes(selected)) {
          for (const option of peer.options) { peer.value = option.value;
            if (projectCueActionEligibility(authoring.value.document, semantic()).available) break; }
        }
        render();
        host.querySelector<HTMLButtonElement>('button[aria-pressed=true]')?.focus({ preventScroll: true });
      });
      wrapper.append(button, reason); return wrapper;
    }));
    const previousCue = cue.value; cue.replaceChildren(...authoring.value.document.cues.filter(item => item.schemaVersion === 'motion.cue.v1')
      .map(item => new Option(`${item.label} · ${item.timeMs} ms`, item.id)));
    if ([...cue.options].some(option => option.value === previousCue)) cue.value = previousCue;
    renderActionHistory(host.querySelector('[data-project-action-history]')!, beginEdit, busy);
    updateValidity();
  };
  const beginEdit = (cue: AuthoringCue) => {
    if (form.dataset.projectDraft === 'true') { feedback.value = 'Apply or discard the current action draft before editing another action.'; return; }
    editing = cue; selected = cue.semantic.kind === 'cursor-path' ? 'move' : cue.semantic.kind;
    const value = cue.semantic; const [start, end] = semanticBounds(value);
    const set = (name: string, number: number) => { (form.elements.namedItem(name) as HTMLInputElement).value = String(number); };
    target.value = 'cursorTargetId' in value ? value.cursorTargetId : 'targetId' in value ? value.targetId : value.targetIds[0]!;
    target.disabled = true; set('start', start); set('end', end);
    if (value.kind === 'type') set('steps', value.stepCount);
    if ('waypoints' in value) { set('fromX', value.waypoints[0]!.xPpm / 10000); set('fromY', value.waypoints[0]!.yPpm / 10000);
      set('toX', value.waypoints.at(-1)!.xPpm / 10000); set('toY', value.waypoints.at(-1)!.yPpm / 10000); }
    host.querySelectorAll<HTMLElement>('[data-move-field]').forEach(node => { node.hidden = !('waypoints' in value); });
    host.querySelector<HTMLElement>('[data-peer-field]')!.hidden = true;
    host.querySelector<HTMLElement>('[data-type-field]')!.hidden = value.kind !== 'type';
    host.querySelector<HTMLElement>('[data-hold-hint]')!.hidden = value.kind !== 'hold';
    form.querySelector('[data-action-heading]')!.textContent = `Edit ${labels[selected]}`;
    form.querySelector('[data-apply-action]')!.textContent = 'Update action'; markDraft(form); render();
    (form.elements.namedItem('start') as HTMLInputElement).focus();
  };
  const selectHoldBoundary = () => {
    const doc = authoring.value.document;
    for (const track of doc.tracks.filter(item => item.elementId === target.value)) {
      const app = doc.applications.find(item => item.slots.some(slot => slot.id === track.slotId))!;
      const index = app.slots.findIndex(slot => slot.id === track.slotId); const slot = app.slots[index]!;
      const delay = app.bindings.find(binding => binding.elementId === target.value)!.delayOverridesMs[index]!;
      const frames = doc.rules.find(rule => rule.id === track.ruleId)!.tracks.find(item => item.property === track.property)!.keyframes;
      for (const frame of frames) {
        const enter = delay + frame.offset * slot.durationMs; const duration = Math.min(Math.max(1, Math.floor(slot.durationMs / 4)), doc.durationMs - enter);
        if (projectCueActionEligibility(doc, { kind: 'hold', targetIds: [target.value], enterMs: enter, durationMs: duration, exitMs: enter + duration }).available) {
          (form.elements.namedItem('start') as HTMLInputElement).value = String(enter);
          (form.elements.namedItem('end') as HTMLInputElement).value = String(enter + duration); return;
        }
      }
    }
  };
  target.addEventListener('change', () => { if (form.dataset.projectDraft === 'true') { target.value = lastTarget; feedback.value = 'Apply or discard the current action draft before choosing another object.'; return; } selectedCreationElementId.value = target.value; schedulePreviewSelection(); render(); });
  for (const current of [form, pause]) current.addEventListener('input', () => { markDraft(current); updateValidity(); });
  host.querySelector('[data-discard-action]')!.addEventListener('click', () => { form.reset(); editing = null; target.disabled = false; selected = null; form.querySelector('[data-apply-action]')!.textContent = 'Apply action'; form.dataset.projectDraft = 'false'; render(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!selected || busy || stale(form)) return;
    busy = true; host.dataset.operationPending = 'true'; updateValidity();
    try {
      const result = selected === 'fade' ? await dispatch({ ...operationEnvelope(), kind: 'motion.track.create', elementId: target.value,
        payload: { property: 'opacity', durationMs: number('end') - number('start'), delayMs: number('start'), easing: 'linear', startValue: 0, endValue: 1 } })
        : await prepareAndDispatchIntent(editing ? { kind: 'motion.cue.update', cueId: editing.id, semantic: semantic() }
          : { kind: 'motion.cue.create', creationKey: `action-${crypto.randomUUID()}`, semantic: semantic() });
      feedback.value = result.ok ? `${labels[selected]} applied. Revision ${authoring.value.document.revision}.` : `Action was not applied: ${result.code}.`;
      if (result.ok) { form.dataset.projectDraft = 'false';
        if (editing) editing = authoring.value.document.cues.find(cue => cue.id === editing!.id) as AuthoringCue;
      }
    } finally { busy = false; delete host.dataset.operationPending; render(); feedback.focus({ preventScroll: true }); }
  });
  host.querySelector('[data-discard-pause]')!.addEventListener('click', () => { pause.reset(); pause.dataset.projectDraft = 'false'; render(); });
  pause.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || stale(pause)) return; busy = true; host.dataset.operationPending = 'true'; updateValidity();
    try {
      const result = await dispatch({ ...operationEnvelope(), kind: 'motion.hold.insert', payload: {
        cueId: cue.value, durationMs: Number((pause.elements.namedItem('duration') as HTMLInputElement).value) } });
      feedback.value = result.ok ? `Whole-shot pause applied. Duration ${authoring.value.document.durationMs} ms.` : `Pause was not applied: ${result.code}.`;
      if (result.ok) pause.dataset.projectDraft = 'false';
    } finally { busy = false; delete host.dataset.operationPending; render(); feedback.focus({ preventScroll: true }); }
  });
  document.addEventListener('motion:projection', render); render();
}
