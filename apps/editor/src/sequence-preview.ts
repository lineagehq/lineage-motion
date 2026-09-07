import type { SequenceSnapshot } from '../../../packages/motion-protocol/src/sequence.ts';
import { fetchSequenceExport, createSequenceExportArchive, type SequenceExportBundle } from '../../../packages/motion-protocol/src/sequence-export.ts';

type Runtime = { ready: Promise<void>; seek(ms: number): void; play(): void; pause(): void;
  readState(): { currentTimeMs: number; activeClipId: string; playing: boolean } };
export function sequencePreview(host: HTMLElement, capability: string) {
  host.innerHTML = '<h3>Full animation preview</h3><p>Play all uses the saved storyboard. Edit individual motion in Shot preview below.</p>'
    + '<div class="sequence-screen"><iframe title="Full animation preview" sandbox="allow-scripts allow-same-origin" style="visibility:hidden"></iframe></div>'
    + '<div class="sequence-transport"><button type="button" data-sequence-play>Play all</button><button type="button" data-sequence-pause>Pause all</button>'
    + '<label>Full animation time<input type="range" min="0" max="0" step="1" value="0" data-sequence-scrub></label><output data-sequence-time>0 s</output>'
    + '<button type="button" data-sequence-download>Download full animation</button></div><output data-sequence-preview-status role="status"></output>';
  const frame = host.querySelector<HTMLIFrameElement>('iframe')!;
  const screen = host.querySelector<HTMLElement>('.sequence-screen')!;
  const status = host.querySelector<HTMLOutputElement>('[data-sequence-preview-status]')!;
  const scrub = host.querySelector<HTMLInputElement>('input')!;
  const controls = host.querySelectorAll<HTMLButtonElement>('button');
  let wasPlaying = false; let failed = false; let generation = 0; let runtime: Runtime | null = null; let disabled = true;
  let bundle: SequenceExportBundle | null = null;
  let snapshot: SequenceSnapshot | null = null; let timer: number | null = null;
  function fit() {
    if (!snapshot) return;
    const { widthCssPixels: width, heightCssPixels: height } = snapshot.sequence.viewport;
    const scale = Math.min(1, screen.clientWidth / width, 420 / height);
    frame.style.width = `${width}px`; frame.style.height = `${height}px`; frame.style.transform = `scale(${scale})`;
    screen.style.height = `${height * scale}px`;
  }
  const sync = () => {
    if (!runtime) return;
    const state = runtime.readState(); scrub.value = String(Math.round(state.currentTimeMs));
    host.querySelector<HTMLOutputElement>('[data-sequence-time]')!.value = `${Math.round(state.currentTimeMs) / 1000} s`;
    host.dataset.activeClip = state.activeClipId;
    if (wasPlaying && !state.playing) status.value = state.currentTimeMs >= Number(scrub.max) ? 'Full animation complete.' : 'Saved full animation paused.';
    wasPlaying = state.playing;
  };
  function block(value: boolean) { disabled = value; controls.forEach(button => { button.disabled = value || !runtime; }); scrub.disabled = value || !runtime; }
  host.querySelector('[data-sequence-play]')!.addEventListener('click', () => { if (!disabled) { runtime?.play(); sync(); status.value = runtime?.readState().playing ? 'Playing the saved full animation.' : 'Full animation complete.'; } });
  host.querySelector('[data-sequence-pause]')!.addEventListener('click', () => { runtime?.pause(); sync(); if (runtime) status.value = runtime.readState().currentTimeMs >= Number(scrub.max) ? 'Full animation complete.' : 'Saved full animation paused.'; });
  scrub.addEventListener('input', () => { if (!disabled) { runtime?.seek(Number(scrub.value)); sync(); if (runtime) status.value = runtime.readState().currentTimeMs >= Number(scrub.max) ? 'Full animation complete.' : 'Saved full animation paused.'; } });
  host.querySelector('[data-sequence-download]')!.addEventListener('click', () => {
    if (disabled || !bundle || !snapshot) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(createSequenceExportArchive(bundle))], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = `animation-sequence-r${snapshot.sequence.revision}.zip`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); status.value = 'Full animation download started.';
  });
  new ResizeObserver(fit).observe(screen); block(true);
  return { block, needsRetry: () => failed, async load(next: SequenceSnapshot | null): Promise<Map<string, string>> {
    const own = ++generation; failed = false; wasPlaying = false; runtime?.pause(); runtime = null; snapshot = next; bundle = null;
    if (timer !== null) clearInterval(timer); timer = null; block(true); frame.style.visibility = 'hidden'; fit();
    if (!next?.sequence.clips.length) { status.value = 'Add a compatible shot to play the full animation.'; return new Map(); }
    status.value = 'Preparing the saved full animation…';
    try {
      const result = await fetchSequenceExport('', { actor: 'human', capability }, { projectId: next.sequence.projectId,
        sequenceId: next.sequence.sequenceId, expectedRevision: next.sequence.revision });
      if (own !== generation) return new Map();
      if (!result.ok) throw new Error(result.code);
      bundle = result;
      const parsed = new DOMParser().parseFromString(result.html, 'text/html');
      const thumbs = new Map([...parsed.querySelectorAll<HTMLIFrameElement>('iframe[data-sequence-clip]')]
        .map(child => [child.dataset.sequenceClip!, child.getAttribute('srcdoc')!]));
      await new Promise<void>((resolve, reject) => {
        frame.addEventListener('load', () => resolve(), { once: true }); frame.addEventListener('error', () => reject(new Error('FRAME_FAILED')), { once: true }); frame.srcdoc = result.html;
      });
      if (own !== generation) return new Map();
      const controller = (frame.contentWindow as unknown as { __motionSequence: Runtime }).__motionSequence;
      await controller.ready; if (own !== generation) { controller.pause(); return new Map(); }
      controller.pause(); controller.seek(0); runtime = controller;
      scrub.max = String(next.sequence.clips.reduce((sum, clip) => sum + clip.source.durationMs + clip.endHoldMs, 0));
      frame.style.visibility = 'visible'; fit(); block(false); sync(); timer = window.setInterval(sync, 60);
      status.value = `Saved full animation · revision ${next.sequence.revision}.`; return thumbs;
    } catch { if (own === generation) { failed = true; status.value = 'Full preview unavailable. Refresh the storyboard to retry.'; } return new Map(); }
  } };
}
