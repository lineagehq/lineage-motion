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
