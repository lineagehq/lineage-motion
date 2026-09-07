import type { SequenceSnapshot, SequenceSources } from '../../../packages/motion-protocol/src/sequence.ts';
import { escapeMarkup as e } from './project-entry.js';
export function renderSequenceCards(host: HTMLElement, snapshot: SequenceSnapshot, sources: SequenceSources | null,
  selected: string, thumbnails: Map<string, string>, actions: {
    select(id: string): void; edit(action: string, index: number): void; move(id: string, index: number): void;
    update(id: string): void; open(id: string): void;
  }) {
  const clips = snapshot.sequence.clips; let offset = 0;
  const focus = document.activeElement instanceof HTMLElement && host.contains(document.activeElement)
    ? { clip: document.activeElement.closest<HTMLElement>('[data-clip-id]')?.dataset.clipId, action: document.activeElement.dataset.clipAction } : null;
  host.replaceChildren(...clips.map((clip, index) => {
    const item = document.createElement('li'); item.className = 'sequence-card'; item.dataset.clipId = clip.clipId; item.draggable = true;
    const current = sources?.shots.find(shot => shot.source.documentId === clip.source.documentId);
    const changed = current && current.source.canonicalDigest !== clip.source.canonicalDigest;
    const start = offset; offset += clip.source.durationMs + clip.endHoldMs;
    item.innerHTML = `<button type="button" data-clip-select aria-pressed="${selected === clip.clipId}">${e(clip.name)}</button>
      <div class="sequence-thumbnail" aria-label="Saved first frame of ${e(clip.name)}"></div>
      <p>${start / 1000}–${offset / 1000} s · Shot ${clip.source.durationMs / 1000} s${clip.endHoldMs ? ` + hold ${clip.endHoldMs / 1000} s` : ''}</p>
      <small>Pinned shot revision ${clip.source.revision}</small><div class="sequence-card-actions">
      <button type="button" data-clip-action="earlier" ${index === 0 ? 'disabled data-unavailable="true"' : ''} aria-label="Move ${e(clip.name)} earlier">← Earlier</button>
      <button type="button" data-clip-action="later" ${index === clips.length - 1 ? 'disabled data-unavailable="true"' : ''} aria-label="Move ${e(clip.name)} later">Later →</button>
      <button type="button" data-clip-action="duplicate">Duplicate occurrence</button><button type="button" data-clip-action="remove">Remove occurrence</button>
      <button type="button" data-clip-open>Edit source shot</button></div>
      ${changed ? `<p>Newer saved shot available. This occurrence stays pinned until updated.</p><button type="button" data-clip-update ${current.viewport ? '' : 'disabled data-unavailable="true"'}>Update this occurrence</button>` : ''}`;
    const html = thumbnails.get(clip.clipId);
    if (html) {
      const frame = document.createElement('iframe'); frame.title = `Saved first frame of ${clip.name}`;
      frame.setAttribute('sandbox', 'allow-same-origin'); frame.setAttribute('aria-hidden', 'true'); frame.inert = true; frame.tabIndex = -1;
      const { widthCssPixels: width, heightCssPixels: height } = snapshot.sequence.viewport;
      frame.style.width = `${width}px`; frame.style.height = `${height}px`;
      frame.style.transform = `scale(${180 / width})`; frame.srcdoc = html;
      frame.addEventListener('load', () => frame.contentDocument?.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 0; }));
      const thumb = item.querySelector<HTMLElement>('.sequence-thumbnail')!; thumb.style.height = `${180 * height / width}px`; thumb.append(frame);
    }
    item.querySelector('[data-clip-select]')!.addEventListener('click', () => actions.select(clip.clipId));
    item.querySelectorAll<HTMLButtonElement>('[data-clip-action]').forEach(button => button.addEventListener('click', () => actions.edit(button.dataset.clipAction!, index)));
    item.querySelector('[data-clip-open]')!.addEventListener('click', () => actions.open(clip.source.documentId));
    item.querySelector('[data-clip-update]')?.addEventListener('click', () => actions.update(clip.clipId));
    item.addEventListener('dragstart', event => { event.dataTransfer?.setData('application/x-motion-clip', clip.clipId); });
    item.addEventListener('dragover', event => event.preventDefault());
    item.addEventListener('drop', event => { event.preventDefault(); const id = event.dataTransfer?.getData('application/x-motion-clip'); if (id && clips.some(clip => clip.clipId === id)) actions.move(id, index); });
    return item;
  }));
  if (focus?.clip && focus.action) [...host.querySelectorAll<HTMLElement>('[data-clip-id]')].find(item => item.dataset.clipId === focus.clip)
    ?.querySelector<HTMLElement>(`[data-clip-action="${focus.action}"]`)?.focus();
}
