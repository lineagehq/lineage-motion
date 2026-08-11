import payload from 'virtual:motion-document';
import {
  buildTimeline,
  NativePreviewController,
  type TimelineRow,
} from '../../../packages/preview-runtime/src/index.js';
import './styles.css';

const { document: motionDocument, compiled } = payload;
const timeline = buildTimeline(motionDocument);

document.body.innerHTML = `
  <main class="editor-shell">
    <header class="topbar">
      <div><p class="eyebrow">Read-only motion document</p><h1>Motion Reader</h1></div>
      <div class="transport" aria-label="Preview transport">
        <button type="button" data-play>Play</button>
        <button type="button" data-pause>Pause</button>
        <label>Master time <input data-scrub type="range" min="0" max="${motionDocument.durationMs}" step="1" value="0"></label>
        <output data-playhead>0 ms</output>
      </div>
    </header>
    <section class="workspace">
      <section class="preview-panel" aria-label="Compiled preview">
        <div class="panel-heading"><span>Compiler output</span><span class="status">Sandboxed · native CSS</span></div>
        <iframe data-preview title="Compiled motion preview"></iframe>
        <button class="reduced-toggle" type="button" data-reduced-toggle aria-expanded="false">Inspect reduced motion</button>
        <section data-reduced-motion-panel data-mode="${timeline.reducedMotion.mode}" data-css="${timeline.reducedMotion.css}" class="reduced-panel" hidden>
          <strong>source-snapshot</strong>
          <p>Inspection only. The canonical document and compiler output remain unchanged.</p>
          <pre></pre>
        </section>
      </section>
      <aside class="cue-panel" aria-label="Narrative cues">
        <div class="panel-heading"><span>Narrative cues</span><span>${timeline.cues.length}</span></div>
        <div data-cues class="cue-list"></div>
      </aside>
    </section>
    <section class="timeline-panel" aria-label="Master timeline">
      <div class="panel-heading"><span>Stable element / property tracks</span><span>${timeline.rows.length} tracks</span></div>
      <div data-timeline data-duration-ms="${timeline.durationMs}" class="timeline"></div>
    </section>
  </main>`;

const iframe = required<HTMLIFrameElement>('[data-preview]');
const controller = new NativePreviewController(iframe);
const scrubber = required<HTMLInputElement>('[data-scrub]');
const playhead = required<HTMLOutputElement>('[data-playhead]');

for (const cue of timeline.cues) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.cueId = cue.id;
  button.dataset.schemaVersion = cue.schemaVersion;
  button.dataset.label = cue.label;
  button.dataset.timeMs = String(cue.timeMs);
  button.innerHTML = `<span>${cue.label}<code>${cue.id} · ${cue.schemaVersion}</code></span><time>${cue.timeMs} ms</time>`;
  button.addEventListener('click', () => scrub(cue.timeMs));
  required('[data-cues]').append(button);
}
for (const row of timeline.rows) required('[data-timeline]').append(renderTrack(row));

required<HTMLButtonElement>('[data-play]').addEventListener('click', () => controller.play());
required<HTMLButtonElement>('[data-pause]').addEventListener('click', () => controller.pause());
scrubber.addEventListener('input', () => scrub(Number(scrubber.value)));
const reducedToggle = required<HTMLButtonElement>('[data-reduced-toggle]');
const reducedPanel = required<HTMLElement>('[data-reduced-motion-panel]');
reducedPanel.querySelector('pre')!.textContent = motionDocument.reducedMotion.css;
reducedToggle.addEventListener('click', () => {
  const expanded = reducedToggle.getAttribute('aria-expanded') === 'true';
  reducedToggle.setAttribute('aria-expanded', String(!expanded));
  reducedPanel.hidden = expanded;
});

window.__motionEditor = {
  compiledHtml: compiled.html,
  trackIds: timeline.rows.map((row) => row.trackId),
  cueIds: timeline.cues.map((cue) => cue.id),
  canonicalProjection: timeline,
  readState: () => controller.readState(),
};

await controller.mount(compiled.html);
document.querySelector('main')!.setAttribute('data-editor-ready', 'true');

function scrub(timeMs: number): void {
  controller.scrub(timeMs);
  scrubber.value = String(timeMs);
  playhead.value = `${timeMs} ms`;
}

function renderTrack(row: TimelineRow): HTMLElement {
  const article = document.createElement('article');
  article.className = 'track-row';
  article.dataset.trackId = row.trackId;
  article.dataset.elementId = row.elementId;
  article.dataset.property = row.property;
  article.dataset.ruleId = row.ruleId;
  article.dataset.applicationId = row.applicationId;
  article.dataset.activeSlotId = row.activeSlotId;
  article.dataset.delayMs = String(row.delayMs);
  article.dataset.slotCount = String(row.orderedSlotIds.length);
  article.dataset.interpolation = row.interpolation;
  article.dataset.timing = JSON.stringify(row.timing);
  article.dataset.timingKind = row.timing.kind;
  article.dataset.keyframeCount = String(row.keyframes.length);
  const timing = row.timing.kind === 'steps'
    ? `steps(${row.timing.count}, ${row.timing.position})`
    : row.timing.kind === 'keyword' ? row.timing.value : 'cubic-bezier';
  article.innerHTML = `
    <div class="track-identity"><code>${row.trackId}</code><code>${row.elementId}</code><strong>${row.property}</strong><span>${row.interpolation} · rule ${row.ruleId}</span></div>
    <div class="track-meta"><span>delay ${row.delayMs} ms</span><span>${timing}</span><span>${row.orderedSlotIds.length} ordered slot${row.orderedSlotIds.length === 1 ? '' : 's'}</span><div class="slots"></div></div>
    <div class="keyframes"></div>`;
  const slotList = article.querySelector('.slots')!;
  for (const slotId of row.orderedSlotIds) {
    const slot = document.createElement('code');
    slot.dataset.slotId = slotId;
    slot.dataset.active = String(slotId === row.activeSlotId);
    slot.textContent = `${slotId}${slotId === row.activeSlotId ? ' · active' : ''}`;
    slotList.append(slot);
  }
  const keyframeList = article.querySelector('.keyframes')!;
  for (const keyframe of row.keyframes) {
    const marker = document.createElement('span');
    marker.className = 'keyframe';
    marker.dataset.keyframeId = keyframe.id;
    marker.dataset.offset = String(keyframe.offset);
    marker.dataset.value = keyframe.value;
    marker.dataset.easing = JSON.stringify(keyframe.easing);
    marker.dataset.timeMs = String(keyframe.timeMs);
    marker.innerHTML = `<strong>${keyframe.timeMs} ms</strong><code>${keyframe.id}</code><span>${keyframe.offset * 100}% · ${keyframe.value} · easing ${keyframe.easing ? JSON.stringify(keyframe.easing) : 'inherited'}</span>`;
    keyframeList.append(marker);
  }
  return article;
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error('EDITOR_ELEMENT_MISSING');
  return element;
}
