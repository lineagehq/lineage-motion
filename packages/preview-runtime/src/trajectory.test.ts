import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.js';
import { createPreviewOverlayProjection, invertPreviewClientPoint, NativePreviewController, previewPointerDeltaToPpm,
  projectContentBounds, projectTrajectoryOverlay } from './index.js';

test('projects canonical trajectory geometry without becoming a preview interpolator', () => {
  const imported = importMotionHtml(readFileSync(resolve(import.meta.dirname, '../../../fixtures/public-synthetic/landing-shot1.html'), 'utf8'));
  if (!imported.document) throw new Error(imported.diagnostics[0]?.code);
  const elementId = imported.document.elements[0]!.id;
  const projection = projectTrajectoryOverlay(imported.document, elementId, { widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 });
  expect(projection.eligible).toBe(true);
  if (projection.eligible) expect(projection.waypoints.find((point) => point.timeMs === 700)).toMatchObject({ xPpm: expect.any(Number), yPpm: expect.any(Number) });
});

test('maps bounds and pointer deltas through one invertible uniform v1 projection', () => {
  const result = createPreviewOverlayProjection({ sourceWidthCssPixels: 800, sourceHeightCssPixels: 450,
    iframeRect: { left: 100.25, top: 40.5, right: 767.25, bottom: 415.6875, width: 667, height: 375.1875 },
    overlayRect: { left: 100.25, top: 40.5, right: 767.25, bottom: 415.6875, width: 667, height: 375.1875 },
    devicePixelRatio: 2 });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.projection.schemaVersion).toBe('motion.preview-overlay-projection.v1');
  const mapped = projectContentBounds(result.projection, { left: 220, top: 170, right: 270, bottom: 220, width: 50, height: 50 });
  expect(mapped).toMatchObject({ left: 283.675, top: 182.2375, right: 325.3625, bottom: 223.925 });
  const source = invertPreviewClientPoint(result.projection, { clientX: mapped.left, clientY: mapped.top });
  expect(source.x).toBeCloseTo(220, 10); expect(source.y).toBeCloseTo(170, 10);
  expect(previewPointerDeltaToPpm(result.projection, { clientX: 300, clientY: 200 }, { clientX: 312, clientY: 192 }))
    .toEqual({ deltaXPpm: 17_991, deltaYPpm: -21_323 });
});

test('maps a finite non-800x450 compiler rectangle and derives safe stage microunits from the same source', () => {
  const result = createPreviewOverlayProjection({ sourceWidthCssPixels: 960, sourceHeightCssPixels: 540,
    iframeRect: { left: 12.5, top: 20.25, right: 732.5, bottom: 425.25, width: 720, height: 405 },
    overlayRect: { left: 12.5, top: 20.25, right: 732.5, bottom: 425.25, width: 720, height: 405 }, devicePixelRatio: 2 });
  expect(result.ok).toBe(true); if (!result.ok) return;
  const mapped = projectContentBounds(result.projection, { left: 96, top: 54, right: 192, bottom: 108, width: 96, height: 54 });
  expect(mapped).toEqual({ left: 84.5, top: 60.75, right: 156.5, bottom: 101.25, width: 72, height: 40.5 });
  expect(invertPreviewClientPoint(result.projection, { clientX: mapped.left, clientY: mapped.top })).toEqual({ x: 96, y: 54 });
  expect({ widthMicrounits: result.projection.sourceWidthCssPixels * 1_000_000,
    heightMicrounits: result.projection.sourceHeightCssPixels * 1_000_000 })
    .toEqual({ widthMicrounits: 960_000_000, heightMicrounits: 540_000_000 });
});

test('fails closed for edge mismatch and non-uniform scaling', () => {
  const base = { sourceWidthCssPixels: 800, sourceHeightCssPixels: 450, devicePixelRatio: 2,
    iframeRect: { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 } };
  expect(createPreviewOverlayProjection({ ...base,
    overlayRect: { left: 0, top: 0, right: 638, bottom: 360, width: 638, height: 360 } }))
    .toEqual({ ok: false, code: 'PREVIEW_OVERLAY_EDGE_MISMATCH' });
  expect(createPreviewOverlayProjection({ ...base, iframeRect: { ...base.iframeRect, bottom: 350, height: 350 },
    overlayRect: { ...base.iframeRect, bottom: 350, height: 350 } }))
    .toEqual({ ok: false, code: 'PREVIEW_PROJECTION_NON_UNIFORM' });
  for (const width of [0, -1, 800.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    expect(createPreviewOverlayProjection({ ...base, sourceWidthCssPixels: width, overlayRect: base.iframeRect }))
      .toEqual({ ok: false, code: 'PREVIEW_SOURCE_SIZE_INVALID' });
  }
});

function nativeControllerFixture(styleCount = 1) {
  class KeyframeEffect {}
  class DocumentTimeline {}
  class CSSAnimation {
    currentTime: number | null = 0;
    playState: AnimationPlayState = 'paused';
    effect = new KeyframeEffect();
    timeline = new DocumentTimeline();
    ready = Promise.resolve(this);
    pause() { this.playState = 'paused'; }
    play() { this.playState = 'running'; }
    finish() { this.playState = 'finished'; }
    cancel() { this.playState = 'idle'; this.currentTime = null; }
  }
  let animation = new CSSAnimation(); const frames: FrameRequestCallback[] = []; let frameCallbackCount = 0;
  let boundsReadHook: (() => void) | null = null;
  const target = { dataset: { motionId: 'target' }, isConnected: true, getBoundingClientRect: () => { boundsReadHook?.();
    const offset = typeof animation.currentTime === 'number' ? animation.currentTime / 10 : 0;
    return { left: 10 + offset, top: 20, right: 40 + offset, bottom: 60, width: 30, height: 40 }; } };
  const styles = Array.from({ length: styleCount }, () => { let text = '\n.compiler {}\n'; return { isConnected: true,
    get textContent() { return text; }, set textContent(value: string) { text = value; animation = new CSSAnimation(); const nextAnimation = animation;
      animation.ready = Promise.resolve().then(() => { nextAnimation.currentTime = 0; return nextAnimation; }); } }; });
  const frameDocument = { fonts: { ready: Promise.resolve(), status: 'loaded' }, documentElement: { scrollWidth: 800, scrollHeight: 450,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450 }) },
    body: { scrollWidth: 800, scrollHeight: 450 }, getAnimations: () => [animation],
    querySelectorAll: (selector: string) => selector === 'style' ? styles : [target] };
  const frameWindow = { requestAnimationFrame: (callback: FrameRequestCallback) => { frameCallbackCount += 1; frames.push(callback); return frames.length; },
    getComputedStyle: () => ({ display: 'block' }) };
  let load: (() => void) | undefined; let navigationSource = ''; let navigationCount = 0;
  const iframe = { contentDocument: frameDocument, contentWindow: frameWindow, style: {}, width: '', height: '', setAttribute: () => {},
    addEventListener: (_name: string, callback: () => void) => { load = callback; },
    get srcdoc() { return navigationSource; }, set srcdoc(value: string) { navigationSource = value; navigationCount += 1; queueMicrotask(() => load?.()); } };
  const flushFrames = async () => { let emptyTurns = 0; for (let turn = 0; turn < 32 && emptyTurns < 3; turn += 1) {
    await Promise.resolve(); const callbacks = frames.splice(0); for (const callback of callbacks) callback(0);
    emptyTurns = callbacks.length === 0 ? emptyTurns + 1 : 0;
  } };
  return { controller: new NativePreviewController(iframe as unknown as HTMLIFrameElement), animation, getAnimation: () => animation,
    frameDocument, target, styles, getNavigationCount: () => navigationCount, getFrameCallbackCount: () => frameCallbackCount,
    setBoundsReadHook: (hook: (() => void) | null) => { boundsReadHook = hook; }, flushFrames };
}

test('native measurement restores an unsuperseded exact prior state', async () => {
  const { controller, animation, getFrameCallbackCount } = nativeControllerFixture(); await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(321);
  const measurement = controller.measureTargetBoundsAtTimes(['target'], [700]);
  expect(await measurement).toHaveLength(1); expect(controller.readState()).toEqual({ playheadMs: 321, currentTimes: [321], playStates: ['paused'] });
  expect(animation.currentTime).toBe(321); expect(getFrameCallbackCount()).toBe(0);
});

test('samples distinct exact native bounds paint-atomically with zero animation-frame callbacks', async () => {
  const { controller, getFrameCallbackCount } = nativeControllerFixture();
  await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(321);
  const samples = await controller.measureTargetBoundsAtTimes(['target'], [0, 700, 2100]);
  expect(samples.map((sample) => sample.bounds.left)).toEqual([10, 80, 220]);
  expect(getFrameCallbackCount()).toBe(0);
  expect(controller.readState()).toEqual({ playheadMs: 321, currentTimes: [321], playStates: ['paused'] });
});

test('paint-atomic sampling fails closed for fonts and disconnected target identity', async () => {
  const fonts = nativeControllerFixture(); await fonts.controller.mount('<html></html>', '.compiler {}\n');
  fonts.frameDocument.fonts.status = 'loading';
  await expect(fonts.controller.measureTargetBoundsAtTimes(['target'], [0])).rejects.toThrow('PREVIEW_FONTS_NOT_READY');
  const target = nativeControllerFixture(); await target.controller.mount('<html></html>', '.compiler {}\n'); target.target.isConnected = false;
  await expect(target.controller.measureTargetBoundsAtTimes(['target'], [0])).rejects.toThrow('PREVIEW_GEOMETRY_TARGET_MISSING');
});

test('superseded native measurement never overwrites a newer authoritative scrub', async () => {
  const { controller, animation, setBoundsReadHook } = nativeControllerFixture(); await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(100);
  setBoundsReadHook(() => { setBoundsReadHook(null); controller.scrub(839); });
  const measurement = controller.measureTargetBoundsAtTimes(['target'], [700]);
  await expect(measurement).rejects.toThrow('PREVIEW_GEOMETRY_SUPERSEDED');
  expect(controller.readState()).toEqual({ playheadMs: 839, currentTimes: [839], playStates: ['paused'] });
  expect(animation.currentTime).toBe(839);
});

test('serializes overlapping paused geometry and replacement at the authoritative 700 ms playhead', async () => {
  const { controller, getAnimation, getFrameCallbackCount, setBoundsReadHook } = nativeControllerFixture();
  await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(700);
  let replacement: Promise<void> | null = null;
  setBoundsReadHook(() => { if (!replacement) replacement = controller.applyCompilerCssDraft('.compiler { color: red; }\n'); });
  const measurement = controller.measureTargetBoundsAtTimes(['target'], [0, 700]); await measurement; await replacement;
  expect(controller.readNativeStateHandoff().owner).toBe('idle');
  expect(controller.readState()).toEqual({ playheadMs: 700, currentTimes: [700], playStates: ['paused'] });
  expect(getFrameCallbackCount()).toBe(0);
  expect(getAnimation().constructor.name).toBe('CSSAnimation'); expect(getAnimation().effect.constructor.name).toBe('KeyframeEffect');
  expect(getAnimation().timeline.constructor.name).toBe('DocumentTimeline');
});

test.each(['running', 'finished', 'idle'] as const)('serializes overlap while preserving %s native semantics', async (playState) => {
  const { controller, getAnimation, setBoundsReadHook } = nativeControllerFixture();
  await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(700);
  if (playState === 'running') controller.play();
  else if (playState === 'finished') getAnimation().finish();
  else getAnimation().cancel();
  let replacement: Promise<void> | null = null;
  setBoundsReadHook(() => { if (!replacement) replacement = controller.applyCompilerCssDraft(`.compiler { color: ${playState}; }\n`); });
  const measurement = controller.measureTargetBoundsAtTimes(['target'], [0, 700]); await measurement; await replacement;
  expect(controller.readState().playStates).toEqual([playState]);
  expect(getAnimation().constructor.name).toBe('CSSAnimation');
});

test('a failed lease releases ownership and does not poison later replacement work', async () => {
  const { controller, flushFrames } = nativeControllerFixture();
  await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(700);
  await expect(controller.measureTargetBoundsAtTimes(['target'], [])).rejects.toThrow('PREVIEW_GEOMETRY_REQUEST_INVALID');
  expect(controller.readNativeStateHandoff().owner).toBe('idle');
  const replacement = controller.applyCompilerCssDraft('.compiler { color: green; }\n'); await flushFrames(); await replacement;
  expect(controller.readState()).toEqual({ playheadMs: 700, currentTimes: [700], playStates: ['paused'] });
  expect(controller.readCompilerDraftState().active).toBe(true);
});

test('binds one exact compiler stylesheet and restores compiler-native draft state without replacing the document', async () => {
  const { controller, frameDocument, styles, getAnimation, getFrameCallbackCount, flushFrames } = nativeControllerFixture();
  await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(321);
  const mountedAnimation = getAnimation(); const draft = controller.applyCompilerCssDraft('.compiler { color: red; }\n');
  await flushFrames(); await draft;
  expect(controller.iframe.contentDocument).toBe(frameDocument); expect(getAnimation()).not.toBe(mountedAnimation);
  expect(styles[0]!.textContent).toBe('\n.compiler { color: red; }\n');
  expect(getAnimation().constructor.name).toBe('CSSAnimation'); expect(getAnimation().effect.constructor.name).toBe('KeyframeEffect');
  expect(getAnimation().timeline.constructor.name).toBe('DocumentTimeline');
  expect(controller.readState()).toEqual({ playheadMs: 321, currentTimes: [321], playStates: ['paused'] });
  expect(controller.readCompilerDraftState()).toEqual({ active: true, applicationCount: 1 });
  const restore = controller.restoreCommittedCompilerCss(); await flushFrames(); await restore;
  expect(controller.iframe.contentDocument).toBe(frameDocument); expect(styles[0]!.textContent).toBe('\n.compiler {}\n');
  expect(controller.readState()).toEqual({ playheadMs: 321, currentTimes: [321], playStates: ['paused'] });
  expect(controller.readCompilerDraftState()).toEqual({ active: false, applicationCount: 1 });
  expect(getFrameCallbackCount()).toBe(0);
});

test('preserves exact running native state across an in-place compiler stylesheet draft', async () => {
  const { controller, getAnimation, flushFrames } = nativeControllerFixture();
  await controller.mount('<html></html>', '.compiler {}\n'); controller.scrub(839); controller.play();
  const draft = controller.applyCompilerCssDraft('.compiler { color: blue; }\n'); await flushFrames(); await draft;
  expect(controller.readState()).toEqual({ playheadMs: 839, currentTimes: [839], playStates: ['running'] });
  expect(getAnimation().constructor.name).toBe('CSSAnimation');
});

test('promotes one exact compiler-only HTML change without replacing document or style identity', async () => {
  const { controller, frameDocument, styles, flushFrames } = nativeControllerFixture();
  const oldCss = '.compiler {}\n'; const newCss = '.compiler { color: blue; }\n';
  const oldHtml = `<html><head><style>presentation</style><style>\n${oldCss}</style></head></html>`;
  const newHtml = `<html><head><style>presentation</style><style>\n${newCss}</style></head></html>`;
  await controller.mount(oldHtml, oldCss); controller.scrub(839);
  const styleIdentity = styles[0]; const draft = controller.applyCompilerCssDraft(newCss); await flushFrames(); await draft;
  await expect(controller.promoteCompilerCssCommit({ schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: oldHtml,
    oldCompilerCss: oldCss, newCommittedHtml: newHtml, newCompilerCss: newCss })).resolves.toEqual({
    schemaVersion: 'motion.preview-css-commit-promotion.v1', promoted: true });
  expect(controller.iframe.contentDocument).toBe(frameDocument); expect(styles[0]).toBe(styleIdentity);
  expect(controller.iframe.srcdoc).toBe(oldHtml);
  expect(controller.readCompilerCommitState()).toEqual({ committedHtml: newHtml, lastNavigationSourceHtml: oldHtml,
    committedCompilerCss: newCss, activeCompilerCss: newCss, navigationSourceMatchesCommitted: false });
  expect(controller.readCompilerDraftState()).toEqual({ active: false, applicationCount: 1 });
  expect(controller.readState()).toEqual({ playheadMs: 839, currentTimes: [839], playStates: ['paused'] });
});

test.each([
  ['structural', (oldHtml: string, newHtml: string) => newHtml.replace('</head>', '<div></div></head>'),
    'PREVIEW_CSS_COMMIT_PROMOTION_STRUCTURAL'],
  ['mismatched', (_oldHtml: string, newHtml: string) => newHtml.replace('color: blue', 'color: red'),
    'PREVIEW_CSS_COMMIT_PROMOTION_STRUCTURAL'],
] as const)('rejects %s promotion without advancing committed truth and restores exactly', async (_name, mutate, code) => {
  const { controller, frameDocument, styles, flushFrames } = nativeControllerFixture();
  const oldCss = '.compiler {}\n'; const newCss = '.compiler { color: blue; }\n';
  const oldHtml = `<html><head><style>\n${oldCss}</style></head></html>`;
  const newHtml = `<html><head><style>\n${newCss}</style></head></html>`;
  await controller.mount(oldHtml, oldCss); controller.scrub(321);
  const draft = controller.applyCompilerCssDraft(newCss); await flushFrames(); await draft;
  await expect(controller.promoteCompilerCssCommit({ schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: oldHtml,
    oldCompilerCss: oldCss, newCommittedHtml: mutate(oldHtml, newHtml), newCompilerCss: newCss })).rejects.toThrow(code);
  expect(controller.readCompilerCommitState().committedHtml).toBe(oldHtml);
  const restore = controller.restoreCommittedCompilerCss(); await flushFrames(); await restore;
  expect(controller.iframe.contentDocument).toBe(frameDocument); expect(styles[0]!.textContent).toBe(`\n${oldCss}`);
  expect(controller.readState()).toEqual({ playheadMs: 321, currentTimes: [321], playStates: ['paused'] });
  expect(controller.readCompilerDraftState().active).toBe(false);
});

test('rejects an ambiguous old compiler-style segment without advancing committed truth', async () => {
  const { controller, flushFrames } = nativeControllerFixture();
  const oldCss = '.compiler {}\n'; const newCss = '.compiler { color: blue; }\n';
  const oldHtml = `<html><head><style>\n${oldCss}</style><template>\n${oldCss}</template></head></html>`;
  const newHtml = oldHtml.replace(`\n${oldCss}`, `\n${newCss}`);
  await controller.mount(oldHtml, oldCss);
  const draft = controller.applyCompilerCssDraft(newCss); await flushFrames(); await draft;
  await expect(controller.promoteCompilerCssCommit({ schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: oldHtml,
    oldCompilerCss: oldCss, newCommittedHtml: newHtml, newCompilerCss: newCss }))
    .rejects.toThrow('PREVIEW_CSS_COMMIT_PROMOTION_AMBIGUOUS');
  expect(controller.readCompilerCommitState().committedHtml).toBe(oldHtml);
});

test('falls back to exactly one normal mount after structural promotion rejection', async () => {
  const { controller, getNavigationCount, flushFrames } = nativeControllerFixture();
  const oldCss = '.compiler {}\n'; const newCss = '.compiler { color: blue; }\n';
  const oldHtml = `<html><head><style>\n${oldCss}</style></head></html>`;
  const structuralHtml = `<html><head><style>\n${newCss}</style></head><body><div></div></body></html>`;
  await controller.mount(oldHtml, oldCss);
  const draft = controller.applyCompilerCssDraft(newCss); await flushFrames(); await draft;
  await expect(controller.promoteCompilerCssCommit({ schemaVersion: 'motion.preview-css-commit-promotion.v1', oldCommittedHtml: oldHtml,
    oldCompilerCss: oldCss, newCommittedHtml: structuralHtml, newCompilerCss: newCss }))
    .rejects.toThrow('PREVIEW_CSS_COMMIT_PROMOTION_STRUCTURAL');
  expect(getNavigationCount()).toBe(1);
  await controller.mount(structuralHtml, newCss);
  expect(getNavigationCount()).toBe(2); expect(controller.iframe.srcdoc).toBe(structuralHtml);
  expect(controller.readCompilerCommitState().navigationSourceMatchesCommitted).toBe(true);
});

test('fails closed when exact compiler stylesheet binding is missing or ambiguous', async () => {
  await expect(nativeControllerFixture(0).controller.mount('<html></html>', '.compiler {}\n'))
    .rejects.toThrow('PREVIEW_COMPILER_STYLESHEET_BINDING_INVALID');
  await expect(nativeControllerFixture(2).controller.mount('<html></html>', '.compiler {}\n'))
    .rejects.toThrow('PREVIEW_COMPILER_STYLESHEET_BINDING_INVALID');
});
