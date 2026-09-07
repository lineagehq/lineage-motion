import { selectAll } from 'css-select';
import { isTag, isText, type Element, type ParentNode } from 'domhandler';
import { parse } from 'parse5';
import { adapter as treeAdapter } from 'parse5-htmlparser2-tree-adapter';
import postcss, { type Declaration } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import type { MotionDocument } from '../../domain/src/index.ts';

const fail = (): never => { throw new Error('SEQUENCE_VIEWPORT_UNSUPPORTED'); };
// Unknown declarations on a boundary are rejected. These cannot change its box.
const paint = /^(?:background(?:-.+)?|color|opacity|border-radius|border-(?:top-left|top-right|bottom-left|bottom-right)-radius|box-shadow|outline(?:-.+)?|font(?:-.+)?|text-align|text-decoration(?:-.+)?|line-height|white-space|cursor|pointer-events|user-select|visibility)$/;
const safePseudos = new Set([':root', ':first-child', ':last-child', ':only-child', ':first-of-type', ':last-of-type', ':only-of-type', ':nth-child', ':nth-last-child', ':nth-of-type', ':nth-last-of-type', ':empty', ':not', ':is', ':where', ':has']);
const zero = (value: string) => /^(?:0(?:px)?)(?:\s+0(?:px)?){0,3}$/.test(value);
const pixel = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d*px$/.test(value)) return null;
  const size = Number(value.slice(0, -2)); return size <= 8192 ? size : null;
};

/** Certifies only explicit fixed boundary boxes; ambiguity never becomes a guessed viewport. */
export function certifySequenceViewport(document: MotionDocument): { widthCssPixels: number; heightCssPixels: number } {
  try { return certify(document); } catch { return fail(); }
}
function certify(document: MotionDocument) {
  const dom = parse(document.presentation.html, { treeAdapter }) as unknown as ParentNode;
  const html = selectAll('html', dom)[0]; const body = selectAll('body', dom)[0];
  if (!html || !body || !isTag(html) || !isTag(body)) return fail();
  const children = body.children.filter(isTag);
  const stage = children.length === 1 && ['main', 'div'].includes(children[0]!.name) ? children[0]! : undefined;
  const boundaries = [html, body, ...(stage ? [stage] : [])];
  const values = new Map<Element, Map<string, string>>(boundaries.map(node => [node, new Map()]));
  const pending: Array<{ node: Element; declaration: Declaration; conditional: boolean }> = [];
  const record = (node: Element, declaration: Declaration, conditional: boolean) => { pending.push({ node, declaration, conditional }); };
  const apply = (node: Element, declaration: Declaration, conditional: boolean) => {
    const property = declaration.prop.toLowerCase(); const value = declaration.value.trim().toLowerCase();
    if (paint.test(property)) return;
    if (conditional || declaration.important || property.startsWith('--')) return fail();
    const map = values.get(node)!;
    const put = (key: string, content: string) => {
      if (map.has(key) && map.get(key) !== content) return fail(); map.set(key, content);
    };
    if (/^(margin|padding|border)(?:-(?:top|right|bottom|left))?(?:-width)?$/.test(property)) {
      if (!zero(value) && !(property === 'border' && value === 'none')) return fail();
      put(property, '0'); return;
    }
    if (property === 'width' || property === 'height') {
      if (value !== '100%' && pixel(value) === null) return fail(); put(property, value); return;
    }
    if (property === 'overflow' || property === 'overflow-x' || property === 'overflow-y') {
      if (!['hidden', 'clip', 'visible'].includes(value)) return fail(); put(property, value); return;
    }
    const fixed: Record<string, string[]> = { display: ['block'], position: ['static', 'relative'],
      'box-sizing': ['content-box', 'border-box'], 'writing-mode': ['horizontal-tb'], direction: ['ltr'],
      float: ['none'], clear: ['none'] };
    if (!fixed[property]?.includes(value)) return fail(); put(property, value);
  };
  if (selectAll('style', dom).filter(isTag).some(node => 'media' in node.attribs || 'scoped' in node.attribs)) fail();
  const styles = [document.presentation.css, document.reducedMotion.css,
    ...selectAll('style', dom).map(node => node.children.filter(isText).map(text => text.data).join(''))];
  for (const css of styles) {
    const root = postcss.parse(css);
    root.walkAtRules(rule => { if (!['media', 'font-face'].includes(rule.name.toLowerCase())) fail(); });
    root.walkRules(rule => {
      let uncertain = false;
      selectorParser(selectors => selectors.walkPseudos(pseudo => {
        if (!safePseudos.has(pseudo.value.toLowerCase())) uncertain = true;
      })).processSync(rule.selector);
      const declarations = rule.nodes.filter((node): node is Declaration => node.type === 'decl');
      if (uncertain) { if (declarations.some(declaration => !paint.test(declaration.prop.toLowerCase()))) fail(); return; }
      const matches = selectAll(rule.selector, dom);
      for (const node of boundaries.filter(boundary => matches.includes(boundary)))
        for (const declaration of declarations) record(node, declaration, rule.parent?.type !== 'root');
    });
  }
  for (const node of boundaries) {
    if (node.attribs.style) postcss.parse(`x{${node.attribs.style}}`).walkDecls(declaration => record(node, declaration, false));
    if (Object.keys(node.attribs).some(name => ['width', 'height', 'align', 'hidden'].includes(name))) fail();
  }
  for (const item of pending.filter(item => item.node !== stage)) apply(item.node, item.declaration, item.conditional);
  const fixedRoots = [html, body].every(node => pixel(values.get(node)!.get('width')) && pixel(values.get(node)!.get('height')));
  const activeBoundaries = fixedRoots ? [html, body] : boundaries;
  if (!fixedRoots) for (const item of pending.filter(item => item.node === stage)) apply(item.node, item.declaration, item.conditional);
  // Native animations on a boundary can invalidate its box at another sample time.
  const ids = new Set(activeBoundaries.map(node => node.attribs['data-motion-id']).filter(Boolean));
  if (document.applications.some(application => application.bindings.some(binding => ids.has(binding.elementId)))) fail();
  const h = values.get(html)!; const b = values.get(body)!;
  if (b.get('margin') !== '0' && !['top', 'right', 'bottom', 'left'].every(side => b.get(`margin-${side}`) === '0')) fail();
  const clipped = (map: Map<string, string>) => ['x', 'y'].every(axis => {
    const shorthand = map.get('overflow'); const longhand = map.get(`overflow-${axis}`);
    if (shorthand && longhand && shorthand !== longhand) fail();
    return ['hidden', 'clip'].includes(longhand ?? shorthand ?? 'visible');
  });
  const clips = new Map(activeBoundaries.map(node => [node, clipped(values.get(node)!)]));
  const fixedWidth = pixel(h.get('width')); const fixedHeight = pixel(h.get('height'));
  if (fixedWidth && fixedHeight && b.get('width') === h.get('width') && b.get('height') === h.get('height')) {
    if (!clips.get(html) && !clips.get(body)) fail();
    return { widthCssPixels: fixedWidth, heightCssPixels: fixedHeight };
  }
  if (!stage || ![h, b].every(map => map.get('width') === '100%' && map.get('height') === '100%')
    || body.children.some(node => isText(node) && node.data.trim())) return fail();
  const s = values.get(stage)!; const width = pixel(s.get('width')); const height = pixel(s.get('height'));
  if (!width || !height || (!clips.get(stage) && !clips.get(html) && !clips.get(body))) return fail();
  return { widthCssPixels: width, heightCssPixels: height };
}
