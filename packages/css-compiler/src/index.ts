import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { parse } from 'parse5';

import {
  canonicalBytes,
  sha256Hex,
  validateMotionDocument,
  type MotionDocument,
  type TimingFunction,
} from '../../domain/src/index.js';

export const COMPILER_VERSION = 'css-compiler.v1';

export type CompilerReceipt = {
  schemaVersion: 'motion.compiler-receipt.v1';
  compilerVersion: typeof COMPILER_VERSION;
  sourceDigest: string;
  documentDigest: string;
  exportDigest: string;
  deterministic: true;
  warningCount: number;
  errorCount: number;
  inventory: Pick<MotionDocument['inventory'],
    'ruleCount' | 'applicationCount' | 'slotCount' | 'trackCount'
    | 'supportedCount' | 'unsupportedCount' | 'missingCount'>;
  provenance: MotionDocument['provenance'];
};

export type CompilerResult = {
  html: string;
  css: string;
  exportDigest: string;
  receipt: CompilerReceipt;
};

export function compileMotionDocument(document: MotionDocument): CompilerResult {
  const validation = validateMotionDocument(document);
  if (!validation.ok) {
    throw new Error(validation.diagnostics[0]?.code ?? 'COMPILER_DOCUMENT_INVALID');
  }
  assertNoExecutableHtml(document.presentation.html);
  assertNoInlineMotion(document.presentation.html);
  assertNoLiveResources(document.presentation.html, document.presentation.css);
  assertNoOpaqueMotion(document.presentation.css);

  const generatedNames = new Map(
    document.rules.map((rule, index) => [rule.id, `motion_rule_${String(index).padStart(4, '0')}`]),
  );
  const cssParts: string[] = [];
  const presentationCss = document.presentation.css.trim();
  if (presentationCss) cssParts.push(presentationCss);

  if ((document.holds ?? []).length > 0) {
    cssParts.push(...compileHoldProjection(document));
  } else {
  for (const application of document.applications) {
    for (const binding of application.bindings) {
      const slotCss = application.slots.map((slot, slotIndex) => {
        const generatedName = generatedNames.get(slot.ruleId);
        if (!generatedName) throw new Error('COMPILER_UNKNOWN_RULE');
        return [
          generatedName,
          formatTime(slot.durationMs),
          formatTimingFunction(slot.timingFunction),
          formatTime(binding.delayOverridesMs[slotIndex]!),
          String(slot.iterationCount),
          slot.direction,
          slot.fillMode,
          slot.playState,
        ].join(' ');
      }).join(', ');
      const selector = `[data-motion-id="${escapeCssString(binding.elementId)}"]`;
      cssParts.push(`${selector} {\n  animation: ${slotCss};\n}`);
    }
  }

  for (const rule of document.rules) {
    const generatedName = generatedNames.get(rule.id)!;
    const offsets = [...new Set(rule.tracks.flatMap((track) =>
      track.keyframes.map((keyframe) => keyframe.offset),
    ))].sort((a, b) => a - b);
    const blocks = offsets.map((offset) => {
      const declarations: string[] = [];
      let easing: TimingFunction | undefined;
      for (const track of rule.tracks) {
        const keyframe = track.keyframes.find((candidate) => candidate.offset === offset);
        if (!keyframe) continue;
        declarations.push(`    ${track.property}: ${keyframe.value};`);
        easing ??= keyframe.easing;
      }
      if (easing) declarations.push(`    animation-timing-function: ${formatTimingFunction(easing)};`);
      return `  ${formatOffset(offset)} {\n${declarations.join('\n')}\n  }`;
    });
    cssParts.push(`@keyframes ${generatedName} {\n${blocks.join('\n')}\n}`);
  }
  }

  const css = `${cssParts.join('\n\n')}\n`;
  const styleElement = `<style>\n${css}</style>`;
  const html = document.presentation.html.includes('</head>')
    ? `${document.presentation.html.replace('</head>', `${styleElement}\n</head>`).trim()}\n`
    : `${styleElement}\n${document.presentation.html.trim()}\n`;
  const documentDigest = digest(canonicalBytes(document));
  const exportDigest = digest(`${html}\0${css}`);
  const inventory = document.inventory;
  const receipt: CompilerReceipt = {
    schemaVersion: 'motion.compiler-receipt.v1',
    compilerVersion: COMPILER_VERSION,
    sourceDigest: inventory.sourceDigest,
    documentDigest,
    exportDigest,
    deterministic: true,
    warningCount: 0,
    errorCount: 0,
    inventory: {
      ruleCount: inventory.ruleCount,
      applicationCount: inventory.applicationCount,
      slotCount: inventory.slotCount,
      trackCount: inventory.trackCount,
      supportedCount: inventory.supportedCount,
      unsupportedCount: inventory.unsupportedCount,
      missingCount: inventory.missingCount,
    },
    provenance: document.provenance,
  };
  return { html, css, exportDigest, receipt };
}

function compileHoldProjection(document: MotionDocument): string[] {
  const hold = document.holds?.[0];
  if (!hold) return [];
  const output: string[] = [];
  let sequence = 0;
  for (const application of document.applications) {
    for (const binding of application.bindings) {
      const animations: string[] = [];
      for (const [slotIndex, slot] of application.slots.entries()) {
        const rule = document.rules.find((candidate) => candidate.id === slot.ruleId);
        const sourceDelay = binding.delayOverridesMs[slotIndex];
        if (!rule || sourceDelay === undefined) throw new Error('COMPILER_HOLD_RELATIONSHIP_INVALID');
        if (slot.iterationCount !== 1) throw new Error('COMPILER_HOLD_ITERATION_UNSUPPORTED');
        const generatedName = `motion_hold_${String(sequence).padStart(4, '0')}`;
        sequence += 1;
        const storyDelay = warpTime(sourceDelay, hold.sourceTimeMs, hold.durationMs);
        const sourceEnd = sourceDelay + slot.durationMs;
        const storyEnd = warpTime(sourceEnd, hold.sourceTimeMs, hold.durationMs);
        const storyDuration = storyEnd - storyDelay;
        animations.push([
          generatedName, formatTime(storyDuration), 'linear', formatTime(storyDelay),
          String(slot.iterationCount), slot.direction, slot.fillMode, slot.playState,
        ].join(' '));
        output.push(compileWarpedKeyframes(
          generatedName, rule.tracks, sourceDelay, slot.durationMs, storyDelay, storyDuration,
          slot.timingFunction, hold.sourceTimeMs, hold.durationMs,
        ));
      }
      output.unshift(`[data-motion-id="${escapeCssString(binding.elementId)}"] {\n  animation: ${animations.join(', ')};\n}`);
    }
  }
  return output;
}

type WarpedDeclaration = { property: string; value: string; easing?: TimingFunction };

function compileWarpedKeyframes(
  name: string,
  tracks: MotionDocument['rules'][number]['tracks'],
  sourceDelay: number,
  sourceDuration: number,
  storyDelay: number,
  storyDuration: number,
  slotEasing: TimingFunction,
  boundary: number,
  holdDuration: number,
): string {
  const blocks = new Map<number, WarpedDeclaration[]>();
  const add = (storyTime: number, declaration: WarpedDeclaration): void => {
    const offset = (storyTime - storyDelay) / storyDuration;
    const declarations = blocks.get(offset) ?? [];
    declarations.push(declaration);
    blocks.set(offset, declarations);
  };
  for (const track of tracks) {
    const sourceFrames = track.keyframes.map((keyframe) => ({
      ...keyframe, timeMs: sourceDelay + keyframe.offset * sourceDuration,
    }));
    if (slotEasing.kind === 'steps' && sourceFrames.length === 2) {
      const [first, last] = sourceFrames as [typeof sourceFrames[number], typeof sourceFrames[number]];
      const fractions = Array.from({ length: slotEasing.count + 1 }, (_, index) => index / slotEasing.count);
      const times = new Set(fractions.map((fraction) => first.timeMs + (last.timeMs - first.timeMs) * fraction));
      if (boundary > first.timeMs && boundary < last.timeMs) times.add(boundary);
      for (const timeMs of [...times].sort((a, b) => a - b)) {
        const progress = (timeMs - first.timeMs) / (last.timeMs - first.timeMs);
        const stepped = Math.floor(progress * slotEasing.count + 1e-12) / slotEasing.count;
        const value = interpolateCssValue(first.value, last.value, Math.min(1, stepped));
        const storyTime = warpTime(timeMs, boundary, holdDuration);
        add(storyTime, { property: track.property, value,
          easing: { kind: 'steps', count: 1, position: 'end' } });
        if (timeMs === boundary) add(storyTime - holdDuration,
          { property: track.property, value, easing: { kind: 'keyword', value: 'linear' } });
      }
      continue;
    }
    for (const [index, frame] of sourceFrames.entries()) {
      const next = sourceFrames[index + 1];
      add(warpTime(frame.timeMs, boundary, holdDuration), {
        property: track.property, value: frame.value, easing: frame.easing ?? slotEasing,
      });
      if (!next || boundary <= frame.timeMs || boundary >= next.timeMs) continue;
      const fraction = (boundary - frame.timeMs) / (next.timeMs - frame.timeMs);
      const easing = frame.easing ?? slotEasing;
      if (track.interpolation === 'continuous') {
        const split = splitTimingFunction(easing, fraction);
        const value = interpolateCssValue(frame.value, next.value, split.progress);
        const startOffset = (warpTime(frame.timeMs, boundary, holdDuration) - storyDelay) / storyDuration;
        const prior = blocks.get(startOffset)?.find((candidate) => candidate.property === track.property);
        if (prior) prior.easing = split.before;
        add(boundary, { property: track.property, value,
          easing: { kind: 'keyword', value: 'linear' } });
        add(boundary + holdDuration, { property: track.property, value, easing: split.after });
      } else {
        const value = valueAtDiscreteBoundary(sourceFrames, boundary);
        add(boundary, { property: track.property, value,
          easing: { kind: 'keyword', value: 'linear' } });
        add(boundary + holdDuration, { property: track.property, value, easing });
      }
    }
  }
  const rendered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([offset, declarations]) => {
    const lines = declarations.map((declaration) => [
      `    ${declaration.property}: ${declaration.value};`,
      declaration.easing
        ? `    animation-timing-function: ${formatTimingFunction(declaration.easing)};` : '',
    ].filter(Boolean).join('\n'));
    return `  ${formatOffset(offset)} {\n${lines.join('\n')}\n  }`;
  });
  return `@keyframes ${name} {\n${rendered.join('\n')}\n}`;
}

function warpTime(timeMs: number, boundary: number, duration: number): number {
  return timeMs >= boundary ? timeMs + duration : timeMs;
}

function valueAtDiscreteBoundary(
  frames: Array<{ timeMs: number; value: string }>,
  boundary: number,
): string {
  return [...frames].reverse().find((frame) => frame.timeMs <= boundary)?.value ?? frames[0]!.value;
}

function interpolateCssValue(from: string, to: string, progress: number): string {
  const numberPattern = /-?(?:\d+\.?\d*|\.\d+)/g;
  const fromNumbers = [...from.matchAll(numberPattern)].map((match) => Number(match[0]));
  const toNumbers = [...to.matchAll(numberPattern)].map((match) => Number(match[0]));
  const fromShape = from.replace(numberPattern, '#');
  const toShape = to.replace(numberPattern, '#');
  if (fromShape !== toShape || fromNumbers.length !== toNumbers.length) {
    if (progress === 0) return from;
    if (progress === 1) return to;
    throw new Error('COMPILER_HOLD_INTERPOLATION_UNSUPPORTED');
  }
  let index = 0;
  return from.replace(numberPattern, () => formatNumber(
    fromNumbers[index]! + (toNumbers[index]! - fromNumbers[index++]!) * progress,
  ));
}

function splitTimingFunction(
  timing: TimingFunction,
  timeFraction: number,
): { progress: number; before: TimingFunction; after: TimingFunction } {
  if (timing.kind === 'keyword' && timing.value === 'linear') {
    return { progress: timeFraction, before: timing, after: timing };
  }
  const points = timing.kind === 'cubic-bezier'
    ? [timing.x1, timing.y1, timing.x2, timing.y2] as const
    : timing.kind === 'keyword' && timing.value === 'ease-in-out'
      ? [0.42, 0, 0.58, 1] as const : null;
  if (!points) throw new Error('COMPILER_HOLD_EASING_UNSUPPORTED');
  const parameter = solveBezierParameter(timeFraction, points[0], points[2]);
  const [x1, y1, x2, y2] = points;
  const ax = lerp(0, x1, parameter); const ay = lerp(0, y1, parameter);
  const bx = lerp(x1, x2, parameter); const by = lerp(y1, y2, parameter);
  const cx = lerp(x2, 1, parameter); const cy = lerp(y2, 1, parameter);
  const dx = lerp(ax, bx, parameter); const dy = lerp(ay, by, parameter);
  const ex = lerp(bx, cx, parameter); const ey = lerp(by, cy, parameter);
  const splitX = lerp(dx, ex, parameter); const splitY = lerp(dy, ey, parameter);
  const before = { kind: 'cubic-bezier' as const,
    x1: ax / splitX, y1: ay / splitY, x2: dx / splitX, y2: dy / splitY };
  const after = { kind: 'cubic-bezier' as const,
    x1: (ex - splitX) / (1 - splitX), y1: (ey - splitY) / (1 - splitY),
    x2: (cx - splitX) / (1 - splitX), y2: (cy - splitY) / (1 - splitY) };
  return { progress: splitY, before, after };
}

function solveBezierParameter(x: number, x1: number, x2: number): number {
  let low = 0; let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    const value = cubicBezier(mid, x1, x2);
    if (value < x) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

function cubicBezier(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function assertNoOpaqueMotion(css: string): void {
  const root = postcss.parse(css);
  let opaque = false;
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase().endsWith('keyframes')) opaque = true;
  });
  root.walkDecls((declaration) => {
    if (isMotionProperty(declaration.prop)) opaque = true;
  });
  if (opaque) throw new Error('COMPILER_OPAQUE_MOTION');
}

function assertNoLiveResources(html: string, css: string): void {
  if (inspectHtmlPresentation(html).live || /https?:|@import|local\(/i.test(html)) {
    throw new Error('COMPILER_LIVE_RESOURCE');
  }
  const root = postcss.parse(css);
  let live = false;
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase() === 'import') live = true;
  });
  root.walkDecls((declaration) => {
    valueParser(declaration.value).walk((node) => {
      if (node.type !== 'function') return;
      const name = node.value.toLowerCase();
      if (name === 'local') live = true;
      if (name === 'url') {
        const value = valueParser.stringify(node.nodes).trim().replace(/^["']|["']$/g, '');
        if (!value.startsWith('data:')) live = true;
      }
    });
  });
  if (live) throw new Error('COMPILER_LIVE_RESOURCE');
}

function assertNoInlineMotion(html: string): void {
  if (inspectHtmlPresentation(html).motion) throw new Error('COMPILER_OPAQUE_MOTION');
}

function assertNoExecutableHtml(html: string): void {
  if (inspectHtmlPresentation(html).executable) throw new Error('COMPILER_EXECUTABLE_HTML');
}

type HtmlNode = {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

function inspectHtmlPresentation(html: string): { live: boolean; motion: boolean; executable: boolean } {
  const root = parse(html) as unknown as HtmlNode;
  const result = { live: false, motion: false, executable: false };
  const visit = (node: HtmlNode): void => {
    const nodeName = node.nodeName.toLowerCase();
    const attributes = new Map((node.attrs ?? []).map((attribute) =>
      [attribute.name.toLowerCase(), attribute.value],
    ));
    if (['script', 'iframe', 'frame', 'object', 'embed', 'base'].includes(nodeName)) {
      result.live = true;
    }
    if (['animate', 'animatemotion', 'animatetransform', 'set', 'marquee'].includes(nodeName)) {
      result.motion = true;
    }
    for (const [name, value] of attributes) {
      if (/^on/i.test(name)) result.executable = true;
      if (isJavascriptUrlAttribute(name) && value.trim().toLowerCase().startsWith('javascript:')) {
        result.executable = true;
      }
    }
    if (nodeName === 'meta'
      && attributes.get('http-equiv')?.toLowerCase() === 'refresh') result.live = true;
    const resourceAttributes = [
      'src', 'srcset', 'poster', 'data', 'action', 'formaction', 'ping',
      'background', 'manifest', 'codebase', 'archive', 'xlink:href',
    ];
    for (const attribute of resourceAttributes) {
      const value = attributes.get(attribute);
      if (value !== undefined && !value.startsWith('data:') && !value.startsWith('#')) {
        result.live = true;
      }
    }
    const href = attributes.get('href');
    if (href !== undefined
      && nodeName !== 'a'
      && !href.startsWith('data:')
      && !href.startsWith('#')) result.live = true;

    const style = attributes.get('style');
    if (style) inspectCssText(`x { ${style} }`, result);
    if (nodeName === 'style') {
      inspectCssText((node.childNodes ?? []).map((child) => child.value ?? '').join(''), result);
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return result;
}

function inspectCssText(
  css: string,
  result: { live: boolean; motion: boolean },
): void {
  try {
    const root = postcss.parse(css);
    root.walkAtRules((atRule) => {
      const name = atRule.name.toLowerCase();
      if (name === 'import') result.live = true;
      if (name.endsWith('keyframes')) result.motion = true;
    });
    root.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase();
      if (isMotionProperty(property)) {
        result.motion = true;
      }
      valueParser(declaration.value).walk((node) => {
        if (node.type !== 'function') return;
        const name = node.value.toLowerCase();
        if (name === 'local') result.live = true;
        if (name === 'url') {
          const value = valueParser.stringify(node.nodes).trim().replace(/^["']|["']$/g, '');
          if (!value.startsWith('data:')) result.live = true;
        }
      });
    });
  } catch {
    result.live = true;
  }
}

function isMotionProperty(property: string): boolean {
  const lower = property.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '');
  return lower === 'animation' || lower.startsWith('animation-')
    || lower === 'transition' || lower.startsWith('transition-');
}

function isJavascriptUrlAttribute(attribute: string): boolean {
  return [
    'href', 'xlink:href', 'src', 'srcset', 'poster', 'data', 'action', 'formaction',
    'ping', 'background', 'manifest', 'codebase', 'archive',
  ].includes(attribute.toLowerCase());
}

function formatTime(milliseconds: number): string {
  return `${Object.is(milliseconds, -0) ? 0 : milliseconds}ms`;
}

function formatOffset(offset: number): string {
  return `${formatNumber(offset * 100)}%`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTimingFunction(timing: TimingFunction): string {
  if (timing.kind === 'keyword') return timing.value;
  if (timing.kind === 'steps') return `steps(${timing.count}, ${timing.position})`;
  return `cubic-bezier(${formatNumber(timing.x1)}, ${formatNumber(timing.y1)}, ${formatNumber(timing.x2)}, ${formatNumber(timing.y2)})`;
}

function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function digest(input: string | Uint8Array): string {
  return sha256Hex(input);
}
