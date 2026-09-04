import type { Page } from '@playwright/test';
import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { applicationInstanceId, deriveMotionEvidenceBoundaries, expandBoundarySamples, normalizeAnimationInstance, type SemanticAnimationInstance } from '../../domain/src/css-motion-semantics.js';
import { sha256, stableJson, type DiagnosticCode, type OwnerInput, type SamplePoint } from './index.js';
import type { AnimationRecord, Observation, StateRecord } from './acquisition-model.js';

export async function animationRecords(page: Page): Promise<AnimationRecord[]> {
  const raw = await page.evaluate(() => document.getAnimations().map((animation) => {
    if (!(animation instanceof CSSAnimation) || !(animation.effect instanceof KeyframeEffect) || !(animation.effect.target instanceof HTMLElement)) throw new Error('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    if (!(animation.timeline instanceof DocumentTimeline)) throw new Error('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    const timing = animation.effect.getTiming();
    const computed = animation.effect.getComputedTiming();
    const frames = animation.effect.getKeyframes();
    if (animation.effect.composite !== 'replace' || Number(timing.endDelay ?? 0) !== 0
      || Number(timing.iterationStart ?? 0) !== 0 || animation.playbackRate !== 1
      || frames.some((frame) => frame.composite !== 'auto' && frame.composite !== 'replace')) throw new Error('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    return {
      animationName: animation.animationName,
      targetId: animation.effect.target.dataset.motionStable ?? '',
      properties: [...new Set(frames.flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))].sort(),
      durationMs: Number(computed.duration), delayMs: Number(timing.delay ?? 0),
      iterations: computed.iterations === Infinity ? 'infinite' as const : Number(computed.iterations),
      direction: String(timing.direction), fill: String(timing.fill), playState: String(animation.playState), easing: String(timing.easing),
      keyframes: frames.map((frame) => ({
        offset: Number(frame.computedOffset), easing: String(frame.easing ?? 'linear'),
        properties: Object.fromEntries(Object.entries(frame).filter((entry): entry is [string, string] => !['offset', 'computedOffset', 'easing', 'composite'].includes(entry[0]) && typeof entry[1] === 'string').sort(([a], [b]) => a.localeCompare(b))),
      })),
    };
  }));
  const records = raw.map((record): AnimationRecord => {
    const ruleId = `rule_${sha256(record.animationName).slice(0, 24)}`;
    const provenanceId = `source_${sha256(stableJson({ ruleId, targetId: record.targetId, durationMs: record.durationMs, delayMs: record.delayMs, keyframes: record.keyframes })).slice(0, 24)}`;
    const applicationId = applicationInstanceId(record.targetId, ruleId, provenanceId);
    const normalized = normalizeAnimationInstance({
      applicationId, targetId: record.targetId, ruleId, timeline: 'document', composition: 'replace',
      durationMs: record.durationMs, delayMs: record.delayMs, iterations: record.iterations,
      direction: record.direction as SemanticAnimationInstance['direction'], fill: record.fill as SemanticAnimationInstance['fill'],
      playState: record.playState === 'paused' ? 'paused' : 'running', easing: record.easing,
      properties: record.properties,
      keyframes: record.keyframes.map((frame) => ({ offset: frame.offset, easing: frame.easing, properties: Object.keys(frame.properties), values: frame.properties })),
    });
    return { ...normalized, keyframes: normalized.keyframes.map((frame, index) => ({ ...frame, values: record.keyframes[index]!.properties })) };
  });
  if (new Set(records.map((record) => record.applicationId)).size !== records.length) throw coded('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
  return records.sort((a, b) => a.targetId.localeCompare(b.targetId) || stableJson(a).localeCompare(stableJson(b)));
}

export function deriveSchedule(animations: readonly AnimationRecord[], input: OwnerInput): SamplePoint[] {
  const reasons = new Map<number, Set<string>>();
  const add = (time: number, reason: string): void => {
    const clamped = Math.max(0, Math.min(input.procedure.loopDurationMs, Number(time.toFixed(6))));
    const values = reasons.get(clamped) ?? new Set<string>(); values.add(reason); reasons.set(clamped, values);
  };
  const boundary = (time: number, reason: string): void => { add(time - 1, `${reason}:before`); add(time, `${reason}:at`); add(time + 1, `${reason}:after`); };
  boundary(0, 'initial-action'); boundary(input.procedure.loopDurationMs, 'loop'); boundary(input.procedure.settledTimeMs, 'settled');
  for (const sample of expandBoundarySamples(deriveMotionEvidenceBoundaries(animations, input.procedure.loopDurationMs), input.procedure.loopDurationMs, input.procedure.epsilonMs)) {
    for (const reason of sample.reasons) add(sample.timeMs, reason);
  }
  return [...reasons].sort(([a], [b]) => a - b).map(([timeMs, values]) => ({ timeMs, reason: [...values].sort() }));
}

export async function installInstrumentation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { mutations: 0, events: [] as string[] };
    (window as unknown as { __motionProof: typeof state }).__motionProof = state;
    new MutationObserver((records) => { state.mutations += records.length; }).observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
    for (const event of ['click', 'focusin', 'mouseover', 'keydown']) document.addEventListener(event, () => state.events.push(event), { capture: true });
  });
}
export async function readInstrumentation(page: Page): Promise<{ mutations: number; events: string[] }> {
  return page.evaluate(() => (window as unknown as { __motionProof: { mutations: number; events: string[] } }).__motionProof);
}

export async function captureState(page: Page, stableIds: readonly string[], timeMs = 0): Promise<unknown> {
  await pauseAt(page, timeMs);
  return page.evaluate((expectedStableIds) => {
    const elements = [...document.querySelectorAll<HTMLElement>('[data-motion-stable]')];
    const presentStableIds = new Set(elements.map((element) => element.dataset.motionStable));
    if (expectedStableIds.some((stableId) => !presentStableIds.has(stableId))) throw new Error('PREPROCESSOR_BINDING_INVALID');
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.motionStable ?? null : null;
    const elementStates = elements
      .filter((element) => !['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE'].includes(element.tagName))
      .map((element) => {
      const style = getComputedStyle(element); const bounds = element.getBoundingClientRect();
      const computed = Object.fromEntries([...style].sort().map((property) => [property, style.getPropertyValue(property)]));
      const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('');
      const formState = element instanceof HTMLInputElement ? { checked: element.checked, value: element.value }
        : element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? { value: element.value } : null;
      return {
        targetId: element.dataset.motionStable, tag: element.tagName.toLowerCase(), computed, directText, formState,
        bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
        scroll: [element.scrollLeft, element.scrollTop, element.scrollWidth, element.scrollHeight],
      };
    }).sort((a, b) => String(a.targetId).localeCompare(String(b.targetId)));
    return {
      document: {
        activeElement,
        scroll: [window.scrollX, window.scrollY],
        scrollingElement: document.scrollingElement
          ? [document.scrollingElement.scrollLeft, document.scrollingElement.scrollTop, document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight]
          : null,
        viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      },
      elements: elementStates,
    };
  }, stableIds);
}
export async function captureSamples(page: Page, schedule: readonly SamplePoint[], stableIds: readonly string[]): Promise<Array<{ timeMs: number; states: StateRecord[] }>> {
  const output: Array<{ timeMs: number; states: StateRecord[] }> = [];
  for (const sample of schedule) {
    await pauseAt(page, sample.timeMs);
    const states = await page.evaluate((ids) => ids.map((id) => {
      const element = document.querySelector<HTMLElement>(`[data-motion-stable="${id}"]`); if (!element) throw new Error('PREPROCESSOR_BINDING_INVALID');
      const style = getComputedStyle(element); const bounds = element.getBoundingClientRect();
      const computed = Object.fromEntries([...style].sort().map((property) => [property, style.getPropertyValue(property)]));
      return { targetId: id, computed, bounds: [bounds.x, bounds.y, bounds.width, bounds.height] as const };
    }), stableIds);
    const pixelsSha256 = sha256(await page.screenshot({ animations: 'allow' }));
    const withPixels: StateRecord[] = states.map((state) => ({ ...state, pixelsSha256 }));
    output.push({ timeMs: sample.timeMs, states: withPixels });
  }
  return output;
}
export async function pauseAt(page: Page, timeMs: number): Promise<void> {
  await page.evaluate(async (time) => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, timeMs);
}

export function runsStable(runs: Array<{ profile: 'normal' | 'reduced'; observation: Observation }>): boolean {
  return (['normal', 'reduced'] as const).every((profile) => new Set(runs.filter((run) => run.profile === profile).map((run) => stableJson(run.observation))).size === 1);
}
export function semanticObservation(observation: Observation): string {
  return stableJson({ provenance: observation.provenance, animations: observation.animations, samples: observation.samples, resetCheckpoints: observation.resetCheckpoints, events: observation.events });
}
export function assertReplayStructurallySafe(html: string, css: string): void {
  let reparsed: string;
  try { reparsed = serialize(parse(html)); } catch { throw coded('PREPROCESSOR_REPLAY_UNSAFE'); }
  if (serialize(parse(reparsed)) !== reparsed) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
  const forbiddenElements = new Set(['script', 'canvas', 'link', 'iframe', 'frame', 'object', 'embed', 'base', 'video', 'audio', 'source', 'form', 'svg', 'animate', 'animatemotion', 'animatetransform', 'discard', 'set']);
  const resourceAttributes = new Set(['src', 'srcset', 'href', 'xlink:href', 'poster', 'data', 'action', 'formaction', 'ping', 'background', 'manifest']);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] };
    const tagName = record.tagName?.toLowerCase();
    if (tagName && forbiddenElements.has(tagName)) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
    if (tagName === 'meta') {
      const attributes = new Map((record.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
      if (attributes.get('http-equiv')?.trim().toLowerCase() === 'refresh') throw coded('PREPROCESSOR_REPLAY_UNSAFE');
    }
    for (const attribute of record.attrs ?? []) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || resourceAttributes.has(name)) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
      if (name === 'style') assertCssStructurallySafe(`x{${attribute.value}}`);
    }
    for (const child of record.childNodes ?? []) visit(child);
  };
  visit(parse(reparsed));
  assertCssStructurallySafe(css);
}

export function assertCssStructurallySafe(css: string): void {
  let root: postcss.Root;
  try { root = postcss.parse(css); } catch { throw coded('PREPROCESSOR_REPLAY_UNSAFE'); }
  root.walkAtRules((rule) => { if (['import', 'font-face', 'namespace', 'document'].includes(rule.name.toLowerCase())) throw coded('PREPROCESSOR_REPLAY_UNSAFE'); });
  root.walkDecls((declaration) => {
    valueParser(declaration.value).walk((node) => {
      if (node.type === 'function' && ['url', 'image-set', '-webkit-image-set', 'local'].includes(node.value.toLowerCase())) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
    });
  });
}
export function coded(code: DiagnosticCode): Error { const error = new Error(code); error.name = code; return error; }
export function diagnosticFromError(error: unknown): DiagnosticCode {
  const text = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  if (text.includes('CSS_MOTION_')) return 'PREPROCESSOR_CONSTRUCT_UNSUPPORTED';
  const known: DiagnosticCode[] = ['PREPROCESSOR_ROUTE_VIOLATION', 'PREPROCESSOR_RESOURCE_INVALID', 'PREPROCESSOR_BINDING_INVALID', 'PREPROCESSOR_ACTION_INVALID', 'PREPROCESSOR_INVENTORY_MISMATCH', 'PREPROCESSOR_CONSTRUCT_UNSUPPORTED', 'PREPROCESSOR_REPLAY_UNSAFE', 'PREPROCESSOR_CAPTURE_UNSTABLE'];
  return known.find((code) => text.includes(code)) ?? 'PREPROCESSOR_RUNTIME_ERROR';
}
