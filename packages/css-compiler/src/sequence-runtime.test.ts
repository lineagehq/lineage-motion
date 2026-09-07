import { chromium, type Page } from '@playwright/test';
import { expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.js';
import { canonicalBytes, sha256Hex, type MotionDocument } from '../../domain/src/index.js';
import type { SequenceDocument } from '../../domain/src/sequence.js';
import { compileMotionDocument } from './index.js';
import { compileSequence } from './sequence-compiler.js';

function source(color: string, duration: number): MotionDocument {
  const result = importMotionHtml(`<!doctype html><html><head><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden}
.actor{width:30px;height:30px;background:${color};animation:move ${duration}ms linear both}
@keyframes move{from{transform:translateX(0px)}to{transform:translateX(120px)}}
@media(prefers-reduced-motion:reduce){.actor{animation:none;transform:translateX(40px)}}
</style></head><body><div class="actor"></div><span></span></body></html>`);
  if (!result.document) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
function sequence(sources: MotionDocument[], hold = 0): SequenceDocument {
  return { schemaVersion: 'motion.sequence.v1', projectId: 'project', sequenceId: 'sequence', revision: 0, name: 'Public cuts',
    viewport: { widthCssPixels: 320, heightCssPixels: 180 }, finalState: 'last-shot-native-end',
    reducedMotion: 'source-snapshots-with-hard-cuts', clips: sources.map((document, index) => ({ clipId: `clip_${index}`, name: `Shot ${index}`,
      source: { documentId: document.documentId, revision: document.revision, canonicalDigest: sha256Hex(canonicalBytes(document)), durationMs: document.durationMs },
      endHoldMs: index === 0 ? hold : 0 })) };
}
// The test-only declaration reflects the generated public artifact API.
type Runtime = { ready: Promise<void>; seek(ms: number): void; play(): void; pause(): void;
  readState(): { ready: boolean; currentTimeMs: number; activeClipIndex: number; localTimeMs: number; playing: boolean; reducedMotion: boolean } };
async function seek(page: Page, time: number) {
  return page.evaluate(time => {
    const runtime = (window as unknown as { __motionSequence: Runtime }).__motionSequence;
    runtime.seek(time);
    const visible = Array.from(document.querySelectorAll('iframe')).filter(frame => frame.style.visibility === 'visible');
    const frame = visible[0]!, target = frame.contentDocument!.querySelector('.actor')!;
    return { ...runtime.readState(), visibleCount: visible.length, x: new DOMMatrix(frame.contentWindow!.getComputedStyle(target).transform).m41,
      native: frame.contentDocument!.getAnimations().every(animation => animation.constructor.name === 'CSSAnimation'),
      hiddenAccessible: Array.from(document.querySelectorAll('iframe')).some(other => other !== frame && (other.getAttribute('aria-hidden') !== 'true' || !other.inert)) };
  }, time);
}
test('pins exact references, preserves child compiler HTML and emits deterministic sanitized receipts', () => {
  const a = source('red', 1000), b = source('blue', 2000); const input = sequence([a, b]);
  const compiled = compileSequence(input, [a, b]);
  expect(compileSequence(input, [b, a])).toEqual(compiled);
  expect(compiled.receipt.sources[0]!.htmlDigest).toBe(sha256Hex(compileMotionDocument(a).html));
  expect(compiled.receipt.projectId).toBe(input.projectId);
  for (const field of ['unsupportedCount', 'missingCount'] as const) {
    const incomplete = structuredClone(a); incomplete.inventory[field] = 1;
    expect(() => compileSequence(sequence([incomplete]), [incomplete])).toThrow('SEQUENCE_SOURCE_INVENTORY_INCOMPLETE');
  }
  expect(JSON.stringify(compiled.receipt)).not.toContain('Public cuts');
  expect(compiled.html).toContain('sandbox="allow-same-origin"');
  expect(() => compileSequence(input, [a])).toThrow('SEQUENCE_SOURCE_MISSING');
  expect(() => compileSequence(input, [{ ...a, revision: 1 }, b])).toThrow('SEQUENCE_SOURCE_MISSING');
  expect(() => compileSequence(input, [{ ...a, durationMs: 2 }, b])).toThrow('SEQUENCE_SOURCE_DIGEST_MISMATCH');
  expect(() => compileSequence({ ...input, viewport: { widthCssPixels: 640, heightCssPixels: 180 } }, [a, b])).toThrow('SEQUENCE_VIEWPORT_MISMATCH');
  expect(() => compileSequence({ ...input, clips: [] }, [a, b])).toThrow('SEQUENCE_EMPTY');
  const paused = structuredClone(a); paused.applications[0]!.slots[0]!.playState = 'paused';
  expect(() => compileSequence(sequence([paused]), [paused])).toThrow('SEQUENCE_SOURCE_PAUSED_UNSUPPORTED');
  const infinite = structuredClone(a); infinite.applications[0]!.slots[0]!.iterationCount = 'infinite';
  expect(() => compileSequence(sequence([infinite]), [infinite])).toThrow('SEQUENCE_SOURCE_INFINITE');
});

test('native frames obey half-open cuts, end holds, backwards seeks, final endpoint, and playback', async () => {
  const sources = [source('red', 1000), source('blue', 2000)];
  const artifact = compileSequence(sequence(sources, 500), sources);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    await page.setContent(artifact.html);
    await page.evaluate(async () => { const runtime = (window as unknown as { __motionSequence: Runtime }).__motionSequence; await runtime.ready; runtime.pause(); });
    for (const [global, index, local, x] of [[0,0,0,0],[999,0,999,119.88],[1000,0,1000,120],[1499,0,1000,120],
      [1500,1,0,0],[1501,1,1,0.06],[3500,1,2000,120],[3501,1,2000,120],[500,0,500,60]]) {
      const observed = await seek(page, global!);
      expect(observed).toMatchObject({ activeClipIndex: index, localTimeMs: local, visibleCount: 1, native: true, hiddenAccessible: false });
      expect(observed.x).toBeCloseTo(x!, 2);
    }
    await seek(page, 1450);
    await page.evaluate(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.play());
    await page.waitForFunction(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.readState().activeClipIndex === 1);
    await page.evaluate(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.pause());
    const state = await page.evaluate(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.readState());
    expect(state.currentTimeMs).toBeGreaterThanOrEqual(1500); expect(state.playing).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument!.getAnimations().length === 0, undefined, {timeout:3000});
    expect(await seek(page, 1600)).toMatchObject({ reducedMotion: true, activeClipIndex: 1, x: 40 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('iframe')!.contentDocument!.getAnimations().length === 1);
    expect((await seek(page, 2000)).x).toBeCloseTo(30, 2);
  } finally { await browser.close(); }
}, 30000);

test('finite repeats, negative delays, direction and original fill survive repeated occurrences', async () => {
  const original = importMotionHtml(`<!doctype html><html><head><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden}
.actor{width:30px;height:30px;background:red;transform:translateX(7px);animation:move 1000ms linear -500ms 2 alternate none}
@keyframes move{from{transform:translateX(0px)}to{transform:translateX(120px)}}
</style></head><body><div class="actor"></div><span></span></body></html>`).document!;
  expect(original.durationMs).toBe(1500);
  const compiled = compileSequence(sequence([original, original], 300), [original, original]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(compiled.html);
    await page.evaluate(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.ready);
    for (const [time, x] of [[0,60],[500,120],[1000,60],[1499,0.12],[1500,7],[1799,7],[1800,60],[3300,7],[9000,7]]) {
      expect((await seek(page, time!)).x).toBeCloseTo(x!, 2);
    }
  } finally { await browser.close(); }
}, 15000);

test('embedded image decode failure rejects readiness without autoplay or a visible partial shot', async () => {
  const original = source('red', 1000);
  original.presentation.html = original.presentation.html.replace('</body>', '<img src="data:image/png;base64,AAAA" alt=""></body>');
  const compiled = compileSequence(sequence([original]), [original]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent(compiled.html);
    const ready = await page.evaluate(async () => {
      try { await (window as unknown as { __motionSequence: Runtime }).__motionSequence.ready; return true; } catch { return false; }
    });
    expect(ready).toBe(false);
    expect(await page.locator('#sequence-error').innerText()).toContain('could not be prepared');
    expect(await page.evaluate(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.readState())).toMatchObject({ ready: false, playing: false });
    expect(await page.locator('iframe').evaluate(frame => getComputedStyle(frame).visibility)).toBe('hidden');
  } finally { await browser.close(); }
}, 15000);

test.each(['partial', 'none'] as const)('backward seeks preserve finished non-filling animations across %s reduced-motion changes', async mode => {
  const imported = importMotionHtml(`<!doctype html><html><head><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden}
.actor{width:30px;height:30px;background:red;transform:translateX(7px);animation:move 1000ms linear none}
.pulse{width:30px;height:30px;background:blue;animation:pulse 3000ms linear both}
@keyframes move{from{transform:translateX(0px)}to{transform:translateX(120px)}}
@keyframes pulse{from{opacity:0}to{opacity:1}}
${mode === 'partial' ? '@media(prefers-reduced-motion:reduce){.pulse{animation:none}}' : ''}
</style></head><body><div class="actor"></div><div class="pulse"></div></body></html>`);
  expect(imported.inventory.unsupportedCount).toBe(0); expect(imported.inventory.missingCount).toBe(0);
  const original = imported.document!; const compiled = compileSequence(sequence([original]), [original]);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage(); await page.setContent(compiled.html);
    await page.evaluate(() => (window as unknown as { __motionSequence: Runtime }).__motionSequence.ready);
    expect((await seek(page, 500)).x).toBeCloseTo(60, 2);
    expect((await seek(page, 2000)).x).toBe(7);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reference = await browser.newPage({ reducedMotion: 'reduce' });
    await reference.setContent(compileMotionDocument(original).html);
    const expected = await reference.evaluate(() => {
      for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 500; }
      return new DOMMatrix(getComputedStyle(document.querySelector('.actor')!).transform).m41;
    });
    expect(expected).toBe(60);
    expect((await seek(page, 500)).x).toBe(expected);
    await seek(page, 2000); await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect((await seek(page, 500)).x).toBe(expected);
  } finally { await browser.close(); }
}, 15000);
