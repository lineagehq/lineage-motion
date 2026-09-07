import './sequence-storyboard.css';
import { SequenceServiceClient } from '../../../packages/motion-protocol/src/sequence-client.ts';
import { sequenceCommandSchema } from '../../../packages/motion-protocol/src/sequence.ts';
import type { SequenceCatalog, SequenceCommand, SequenceSnapshot, SequenceSources } from '../../../packages/motion-protocol/src/sequence.ts';
import type { SequenceEdit } from '../../../packages/domain/src/sequence.ts';
import { escapeMarkup } from './project-entry.js';
import { captureDraft, activeWaypointDraft, publicationState, pendingRevision } from './main.js';
import { sequencePreview } from './sequence-preview.js';
import { renderSequenceCards } from './sequence-view.js';

export function mountSequenceStoryboard(root: HTMLElement, capability: string): void {
  const client = new SequenceServiceClient('', { actor: 'human', capability });
  const host = document.createElement('section'); host.className = 'sequence-storyboard'; host.setAttribute('aria-label', 'Animation storyboard');
  host.innerHTML = `<header><h2>Build a full animation</h2><p>Arrange saved shots here. Changes to a shot stay separate until you update its reference.</p></header>
    <div class="sequence-tools"><label>Current animation<select data-sequence-select><option value="">Choose an animation</option></select></label><button data-sequence-refresh>Refresh storyboard</button><button data-sequence-import>Create or import a shot</button></div>
    <details data-sequence-new><summary>Create an animation</summary><form data-sequence-create><label>Animation name<input name="name" required maxlength="120"></label><label>First shot<select name="first"></select></label><button>Create animation</button></form></details>
    <output data-sequence-status role="status" aria-live="polite"></output><button data-sequence-retry hidden>Retry unconfirmed change</button>
    <div data-sequence-work hidden><p data-sequence-summary></p><p data-sequence-claim></p><button data-sequence-revoke hidden>Take over animation editing</button>
    <div class="sequence-tools"><label>Saved shot to add<select data-sequence-source></select></label><button data-sequence-add>Add shot</button><button data-sequence-undo>Undo storyboard change</button><button data-sequence-redo>Redo storyboard change</button></div>
    <ol class="sequence-cards" data-sequence-cards aria-label="Saved shot order"></ol>
    <form data-sequence-properties><h3>Selected occurrence</h3><p data-sequence-selected></p>
      <label>Occurrence name<input name="clipName" required maxlength="120"></label><label>End hold (seconds)<input name="hold" type="number" min="0" step="0.001" required></label>
      <button data-sequence-save-name type="button">Apply occurrence name</button><button data-sequence-save-hold type="button">Apply end hold</button>
      <button data-sequence-discard type="button">Discard storyboard draft</button>
    </form><form data-sequence-name><label>Animation name draft<input name="name" required maxlength="120"></label><button>Rename animation</button></form>
    <p data-sequence-conflict hidden role="alert">The saved storyboard changed while you were editing. Your draft is still here. Discard it before editing the newer revision.</p>
    <section class="sequence-preview" data-sequence-preview aria-label="Full animation playback"></section></div>
    <dialog data-sequence-leave><h2>Keep this storyboard draft?</h2><p>Apply the draft first, or discard it to continue.</p><button data-sequence-stay>Stay here</button><button data-sequence-leave-discard>Discard storyboard draft and continue</button></dialog>`;
  root.querySelector('.project-entry')!.after(host);
  root.querySelector('.preview-panel h2')!.textContent = 'Shot preview';
  const get = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const select = get<HTMLSelectElement>('[data-sequence-select]'), source = get<HTMLSelectElement>('[data-sequence-source]');
  const create = get<HTMLFormElement>('[data-sequence-create]'), properties = get<HTMLFormElement>('[data-sequence-properties]'), nameForm = get<HTMLFormElement>('[data-sequence-name]');
  const feedback = get<HTMLOutputElement>('[data-sequence-status]'), dialog = get<HTMLDialogElement>('[data-sequence-leave]');
  const preview = sequencePreview(get('[data-sequence-preview]'), capability);
  let catalog: SequenceCatalog | null = null, sources: SequenceSources | null = null, snapshot: SequenceSnapshot | null = null;
  let selected = '', dirty = false, draftRevision = -1, busy = false, refreshing = false, disposed = false, refreshFailed = false;
  let transitioning = false, previewLoading = false, refreshGeneration = 0, draftSequenceId = '';
  let queuedTarget: string | null = null, queuedPreviewRetry = false;
  let pendingCommand: SequenceCommand | null = null, destination: (() => void) | null = null;
  let thumbs = new Map<string, string>(); let renderGeneration = 0; let cardsKey = ''; const draftFields = new Set<string>();
  const storageKey = `motion-storyboard:${location.host}`;
  const shotPending = () => publicationState.value !== 'settled' || pendingRevision.value !== null || Boolean(root.querySelector('[data-operation-pending="true"]'));
  const shotDirty = () => captureDraft().dirty || Boolean(activeWaypointDraft.value) || Boolean(root.querySelector('[data-project-draft="true"]'));
  const departureBlocked = () => busy || Boolean(pendingCommand);
  const blocked = () => busy || Boolean(pendingCommand) || shotPending() || refreshFailed || transitioning || previewLoading;
  const conflict = () => dirty && (snapshot?.sequence.revision !== draftRevision || (snapshot?.sequence.sequenceId ?? '') !== draftSequenceId);
  const message = (value: string) => { feedback.value = value; };
  const remember = () => { if (snapshot) sessionStorage.setItem(storageKey, JSON.stringify({ sequenceId: snapshot.sequence.sequenceId, clipId: selected })); };
  function controls() {
    host.dataset.sequenceDirty = String(dirty); host.dataset.sequencePending = String(busy || Boolean(pendingCommand));
    get('[data-sequence-conflict]').hidden = !conflict(); get('[data-sequence-retry]').hidden = !pendingCommand || busy;
    for (const button of host.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy || (Boolean(pendingCommand) && !button.hasAttribute('data-sequence-retry'));
    for (const control of [select, source, ...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form input,form select')]) control.disabled = busy || Boolean(pendingCommand) || transitioning || previewLoading;
    const claimed = Boolean(snapshot?.activeClaim);
    for (const selector of ['[data-sequence-add]', '[data-sequence-save-name]', '[data-sequence-save-hold]', '[data-sequence-name] button', '[data-clip-action]', '[data-clip-update]'])
      host.querySelectorAll<HTMLButtonElement>(selector).forEach(button => { button.disabled = blocked() || claimed || conflict() || button.dataset.unavailable === 'true'; });
    get<HTMLButtonElement>('[data-sequence-add]').disabled ||= !source.value || dirty;
    get<HTMLButtonElement>('[data-sequence-undo]').disabled = blocked() || dirty || claimed || !snapshot?.undoAvailable;
    get<HTMLButtonElement>('[data-sequence-redo]').disabled = blocked() || dirty || claimed || !snapshot?.redoAvailable;
    properties.hidden = !snapshot?.sequence.clips.some(clip => clip.clipId === selected) && !dirty;
    preview.block(blocked() || dirty);
  }
  function hydrate() {
    const clip = snapshot?.sequence.clips.find(clip => clip.clipId === selected);
    (properties.elements.namedItem('clipName') as HTMLInputElement).value = clip?.name ?? '';
    (properties.elements.namedItem('hold') as HTMLInputElement).value = String((clip?.endHoldMs ?? 0) / 1000);
    (nameForm.elements.namedItem('name') as HTMLInputElement).value = snapshot?.sequence.name ?? '';
    draftRevision = snapshot?.sequence.revision ?? -1; draftSequenceId = snapshot?.sequence.sequenceId ?? ''; dirty = false; draftFields.clear(); controls();
  }
  function cards() {
    if (!snapshot) return;
    const key = JSON.stringify([snapshot.canonicalDigest, selected, sources, [...thumbs.keys()]]);
    if (key === cardsKey) { controls(); return; } cardsKey = key;
    get('[data-sequence-selected]').textContent = snapshot.sequence.clips.find(clip => clip.clipId === selected)?.name ?? '';
    renderSequenceCards(get('[data-sequence-cards]'), snapshot, sources, selected, thumbs, {
      select: id => guard(() => { selected = id; hydrate(); cards(); remember(); }),
      edit: (id, index) => edit(id === 'duplicate' ? { kind: 'clip.duplicate', clipId: snapshot!.sequence.clips[index]!.clipId, newClipId: `clip_${crypto.randomUUID()}`, name: `${snapshot!.sequence.clips[index]!.name.slice(0,114)} copy` }
        : id === 'remove' ? { kind: 'clip.remove', clipId: snapshot!.sequence.clips[index]!.clipId }
          : { kind: 'clip.move', clipId: snapshot!.sequence.clips[index]!.clipId, index: id === 'earlier' ? index - 1 : index + 1 }),
      move: (clipId, index) => edit({ kind: 'clip.move', clipId, index }),
      update: clipId => { const clip = snapshot!.sequence.clips.find(clip => clip.clipId === clipId)!;
        const current = sources?.shots.find(shot => shot.source.documentId === clip.source.documentId);
        if (current?.viewport) void edit({ kind: 'clip.update-source', clipId, source: current.source }); },
      open: id => guard(() => {
        const current = sources?.shots.find(shot => shot.source.documentId === id);
        if (!current) return message('This source shot is unavailable. Refresh the storyboard before opening it.');
        remember(); const choice = root.querySelector<HTMLSelectElement>('[data-project-shot]')!;
        if (![...choice.options].some(option => option.value === id)) choice.add(new Option(current.name, id));
        choice.value = id; choice.dispatchEvent(new Event('change', { bubbles: true }));
      }, true),
    }); controls();
  }
  function renderSources() {
    const choices = (sources?.shots ?? []).map(shot => {
      const compatible = shot.viewport && (!snapshot || (shot.viewport.widthCssPixels === snapshot.sequence.viewport.widthCssPixels && shot.viewport.heightCssPixels === snapshot.sequence.viewport.heightCssPixels));
      return `<option value="${escapeMarkup(shot.source.documentId)}" ${compatible ? '' : 'disabled'}>${escapeMarkup(shot.name)} · ${shot.source.durationMs / 1000} s${compatible ? '' : ' · unavailable: '+escapeMarkup(shot.reasonCode ?? 'different canvas size')}</option>`;
    }).join('');
    const old = source.value; source.innerHTML = `<option value="">Choose a saved shot</option>${choices}`; if ([...source.options].some(option => option.value === old && !option.disabled)) source.value = old;
    const first = create.elements.namedItem('first') as HTMLSelectElement; const previous = first.value;
    first.innerHTML = '<option value="">Empty animation · 800 × 450</option>' + (sources?.shots ?? []).map(shot => `<option value="${escapeMarkup(shot.source.documentId)}" ${shot.viewport ? '' : 'disabled'}>${escapeMarkup(shot.name)}${shot.viewport ? '' : ' · unavailable'}</option>`).join(''); first.value = previous;
  }
  async function display(next: SequenceSnapshot | null, retryPreview = false) {
    const revisionChanged = !snapshot || !next || snapshot.canonicalDigest !== next.canonicalDigest;
    snapshot = next; get('[data-sequence-work]').hidden = !next;
    if (!next) { await preview.load(null); return; }
    if (!dirty && !next.sequence.clips.some(clip => clip.clipId === selected)) selected = next.sequence.clips[0]?.clipId ?? '';
    if (!dirty) hydrate();
    get('[data-sequence-summary]').textContent = `${next.sequence.name} · ${next.sequence.clips.length} shots · ${next.sequence.clips.reduce((sum, clip) => sum + clip.source.durationMs + clip.endHoldMs, 0) / 1000} s · Saved revision ${next.sequence.revision}`;
    get('[data-sequence-claim]').textContent = next.activeClaim ? 'An agent is editing this animation. Take over explicitly to make changes.' : 'You can edit this animation.';
    get('[data-sequence-revoke]').hidden = !next.activeClaim;
    renderSources(); cards(); remember();
    if (revisionChanged || (retryPreview && preview.needsRetry())) {
      const generation = ++renderGeneration; previewLoading = true; thumbs = new Map(); cards();
      const result = await preview.load(next);
      if (generation === renderGeneration) { previewLoading = false; thumbs = result; cards(); controls(); }
    }
  }
  async function refresh(target = snapshot?.sequence.sequenceId ?? '', retryPreview = false, force = false) {
    if (busy && !force) return;
    if (refreshing && !force) { if (retryPreview || target !== (snapshot?.sequence.sequenceId ?? '')) { queuedTarget = target; queuedPreviewRetry ||= retryPreview; } return; }
    const own = ++refreshGeneration; refreshing = true;
    try {
      const [nextCatalog, nextSources] = await Promise.all([client.catalog(), client.sources()]);
      if (own !== refreshGeneration) return;
      const id = nextCatalog.sequences.some(item => item.sequenceId === target) ? target : '';
      const next = id ? await client.snapshot(id) : null;
      if (own !== refreshGeneration) return;
      catalog = nextCatalog; sources = nextSources; refreshFailed = false;
      select.innerHTML = '<option value="">Choose an animation</option>' + catalog.sequences.map(item => `<option value="${escapeMarkup(item.sequenceId)}">${escapeMarkup(item.name)}</option>`).join('');
      select.value = id; if (transitioning) selected = ''; renderSources(); await display(next, retryPreview); controls();
    } catch { if (own === refreshGeneration) { refreshFailed = true; controls(); message('Could not refresh the storyboard. Your input is still here; try Refresh storyboard.'); } }
    finally {
      if (own === refreshGeneration) {
        refreshing = false; transitioning = false; controls();
        if (queuedTarget !== null) { const next = queuedTarget, retry = queuedPreviewRetry; queuedTarget = null; queuedPreviewRetry = false; void refresh(next, retry); }
      }
    }
  }
  async function execute(command: SequenceCommand) {
    if (busy) return;
    const validated = sequenceCommandSchema.safeParse(command);
    if (!validated.success) {
      message('Change not applied. Names must contain text and timing must be valid. Your draft is retained.');
      const form = command.kind === 'sequence.create' ? create : command.kind === 'sequence.edit' && command.edit.kind === 'sequence.rename' ? nameForm : properties;
      form.querySelector<HTMLInputElement>('input')?.focus(); controls(); return;
    }
    command = validated.data; busy = true; ++refreshGeneration; ++renderGeneration; pendingCommand = command; controls(); message('Saving storyboard…');
    try {
      const result = await client.execute(command);
      if (!result.ok) {
        pendingCommand = null; busy = false;
        message(result.code === 'SEQUENCE_STALE_REVISION' ? 'A newer storyboard was saved. Your draft is retained; discard it before retrying.'
          : `Change not applied: ${result.reasonCode ?? result.code}. Your draft is retained.`);
        await refresh(command.sequenceId, false, true); return;
      }
      pendingCommand = null;
      const field = command.kind === 'sequence.edit' ? ({ 'clip.rename': 'clipName', 'clip.hold': 'hold', 'sequence.rename': 'sequenceName' } as Record<string,string>)[command.edit.kind] : null;
      if (field) draftFields.delete(field); else if (!command.kind.startsWith('sequence.claim.')) draftFields.clear();
      dirty = draftFields.size > 0; if (!command.kind.startsWith('sequence.claim.')) draftRevision = result.revision; await refresh(command.sequenceId, false, true);
      message(refreshFailed ? 'The change was saved, but the new storyboard could not be loaded. Refresh before continuing.' : `Storyboard saved · revision ${result.revision}.`);
    } catch { message('Could not confirm this change. Retry the same change to check its saved result. Your draft remains here.'); }
    finally { busy = false; controls(); }
  }
  function command(kind: SequenceCommand['kind']) { return { protocolVersion: 'motion.sequence-protocol.v1' as const, kind,
    projectId: catalog!.projectId, sequenceId: snapshot!.sequence.sequenceId, expectedRevision: snapshot!.sequence.revision, operationId: `seq_${crypto.randomUUID()}` }; }
  async function edit(edit: SequenceEdit, fromDraft = false) {
    if (!snapshot || blocked() || conflict()) return;
    if (dirty && !fromDraft) return message('Apply or discard the storyboard draft first.');
    await execute({ ...command('sequence.edit'), kind: 'sequence.edit', edit });
  }
  function guard(action: () => void, departure = false) {
    if (departure ? departureBlocked() : blocked()) return message('Wait for the current change or retry its unconfirmed result first.');
    if (dirty) { destination = action; dialog.showModal(); } else action();
  }
  const mark = (event: Event) => { const target = event.target as HTMLInputElement; draftFields.add(target.form === create ? 'create' : target.form === nameForm ? 'sequenceName' : target.name); if (!dirty) { draftRevision = snapshot?.sequence.revision ?? -1; draftSequenceId = snapshot?.sequence.sequenceId ?? ''; } dirty = true; controls(); };
  properties.addEventListener('input', mark); nameForm.addEventListener('input', mark); create.addEventListener('input', mark);
  select.addEventListener('change', () => { const next = select.value; select.value = snapshot?.sequence.sequenceId ?? ''; guard(() => { transitioning = true; controls(); void refresh(next, false, true); }); });
  get('[data-sequence-refresh]').addEventListener('click', () => void refresh(snapshot?.sequence.sequenceId ?? '', true));
  get('[data-sequence-discard]').addEventListener('click', () => { hydrate(); create.reset(); message('Storyboard draft discarded.'); });
  get('[data-sequence-stay]').addEventListener('click', () => { destination = null; dialog.close(); });
  get('[data-sequence-leave-discard]').addEventListener('click', () => { if (departureBlocked()) return; hydrate(); dialog.close(); const action = destination; destination = null; action?.(); });
  get('[data-sequence-retry]').addEventListener('click', () => { if (pendingCommand) void execute(pendingCommand); });
  get('[data-sequence-import]').addEventListener('click', () => guard(() => { const entry = root.querySelector<HTMLDetailsElement>('[data-new-shot]')!; entry.open = true; entry.scrollIntoView({ block: 'start' }); entry.querySelector<HTMLInputElement>('input')?.focus(); }, true));
  get('[data-sequence-add]').addEventListener('click', () => {
    const chosen = sources?.shots.find(shot => shot.source.documentId === source.value); if (!chosen?.viewport) return;
    void edit({ kind: 'clip.add', clip: { clipId: `clip_${crypto.randomUUID()}`, name: chosen.name, source: chosen.source, endHoldMs: 0 }, index: snapshot!.sequence.clips.length });
  });
  get('[data-sequence-save-name]').addEventListener('click', () => {
    const input = properties.elements.namedItem('clipName') as HTMLInputElement; if (!input.reportValidity()) return;
    void edit({ kind: 'clip.rename', clipId: selected, name: input.value }, true);
  });
  get('[data-sequence-save-hold]').addEventListener('click', () => {
    const input = properties.elements.namedItem('hold') as HTMLInputElement; const [whole, fraction = ''] = input.value.split('.'); const ms = Number(whole || 0) * 1000 + Number(fraction.padEnd(3, '0'));
    if (!/^(?:\d+|\d*\.\d{1,3})$/.test(input.value) || !Number.isSafeInteger(ms) || ms < 0) { input.setCustomValidity('Enter a nonnegative number of seconds, precise to a millisecond.'); input.reportValidity(); message('Hold not applied. Enter seconds to a maximum of three decimal places.'); return; }
    input.setCustomValidity(''); void edit({ kind: 'clip.hold', clipId: selected, endHoldMs: ms }, true);
  });
  properties.addEventListener('input', () => (properties.elements.namedItem('hold') as HTMLInputElement).setCustomValidity(''));
  properties.addEventListener('submit', event => event.preventDefault());
  nameForm.addEventListener('submit', event => { event.preventDefault(); void edit({ kind: 'sequence.rename', name: (nameForm.elements.namedItem('name') as HTMLInputElement).value }, true); });
  for (const kind of ['undo', 'redo'] as const) get(`[data-sequence-${kind}]`).addEventListener('click', () => { if (!dirty && !blocked() && snapshot) void execute({ ...command(`sequence.${kind}`), kind: `sequence.${kind}` }); });
  get('[data-sequence-revoke]').addEventListener('click', () => {
    if (!snapshot?.activeClaim || blocked()) return;
    void execute({ ...command('sequence.claim.revoke'), kind: 'sequence.claim.revoke', claimId: snapshot.activeClaim.claimId, expectedLeaseVersion: snapshot.activeClaim.leaseVersion });
  });
  create.addEventListener('submit', event => {
    event.preventDefault(); if ([...draftFields].some(field => field !== 'create')) return message('Apply or discard the selected occurrence draft first.');
    if (!catalog || blocked() || shotDirty()) return message('Apply or discard the current shot draft before creating an animation.');
    const first = sources?.shots.find(shot => shot.source.documentId === (create.elements.namedItem('first') as HTMLSelectElement).value);
    void execute({ protocolVersion: 'motion.sequence-protocol.v1', kind: 'sequence.create', projectId: catalog.projectId,
      sequenceId: `sequence_${crypto.randomUUID()}`, expectedRevision: 0, operationId: `seq_${crypto.randomUUID()}`, name: (create.elements.namedItem('name') as HTMLInputElement).value,
      viewport: first?.viewport ?? { widthCssPixels: 800, heightCssPixels: 450 }, claim: false,
      initialClip: first ? { clipId: `clip_${crypto.randomUUID()}`, name: first.name, source: first.source, endHoldMs: 0 } : null });
  });
  root.querySelector<HTMLSelectElement>('[data-project-shot]')!.addEventListener('change', event => {
    if (!dirty && !departureBlocked()) return;
    event.stopImmediatePropagation(); const shot = event.currentTarget as HTMLSelectElement; const next = shot.value;
    shot.value = new URLSearchParams(location.search).get('shot') ?? shot.options[0]?.value ?? '';
    guard(() => { shot.value = next; shot.dispatchEvent(new Event('change', { bubbles: true })); }, true);
  }, true);
  root.querySelector('[data-shot-create]')!.addEventListener('submit', event => {
    if (dirty || departureBlocked()) { event.preventDefault(); event.stopImmediatePropagation(); message(departureBlocked() ? 'Wait for the current storyboard change or retry its unconfirmed result first.' : 'Apply or discard the storyboard draft before creating a shot.'); }
  }, true);
  window.addEventListener('beforeunload', event => { if (dirty || busy || pendingCommand) event.preventDefault(); });
  window.addEventListener('pagehide', () => { disposed = true; });
  let initial = ''; try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'); initial = saved.sequenceId ?? ''; selected = saved.clipId ?? ''; } catch { /* No saved selection yet. */ }
  void refresh(initial);
  const poll = window.setInterval(() => { if (disposed) { clearInterval(poll); return; } if (!busy && !pendingCommand) void refresh(); controls(); }, 1000);
}
