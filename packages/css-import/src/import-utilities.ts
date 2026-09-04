import { createHash } from 'node:crypto';
import { selectAll } from 'css-select';
import type { AnyNode, Element, ParentNode } from 'domhandler';
import { isTag } from 'domhandler';
import { serialize } from 'parse5';
import type { AtRule, Declaration, Node as PostCssNode, Rule } from 'postcss';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { classifyAnimatedProperty, deriveElementId, type Diagnostic } from '../../domain/src/index.js';
import { animationLonghandPropertySet, type ImportResult, type MutableInventory, type V3ImportIdentity } from './index.js';

export function detectUnsupportedCss(
  root: postcss.Root,
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
): void {
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const motionProperty = classifyMotionProperty(property);
    if (motionProperty === 'prefixed') {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_PREFIXED_MOTION_UNSUPPORTED',
        'Vendor-prefixed motion declarations are not supported.', declaration);
      return;
    }
    if (motionProperty === 'transition') {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_TRANSITION_UNSUPPORTED',
        'Transitions are not supported.', declaration);
      return;
    }
    const mapping: Record<string, [string, string]> = {
      'animation-composition': ['IMPORT_COMPOSITION_UNSUPPORTED', 'Animation composition is deferred.'],
      'animation-timeline': ['IMPORT_TIMELINE_UNSUPPORTED', 'Animation timelines are deferred.'],
      'animation-range': ['IMPORT_RANGE_UNSUPPORTED', 'Animation ranges are deferred.'],
      'animation-range-start': ['IMPORT_RANGE_UNSUPPORTED', 'Animation ranges are deferred.'],
      'animation-range-end': ['IMPORT_RANGE_UNSUPPORTED', 'Animation ranges are deferred.'],
      'animation-trigger': ['IMPORT_TRIGGER_UNSUPPORTED', 'Event-driven animation triggers are deferred.'],
    };
    const unsupported = mapping[property];
    if (unsupported) addCssDiagnostic(diagnostics, inventory, unsupported[0], unsupported[1], declaration);
    else if (property.startsWith('animation-')
      && !animationLonghandPropertySet.has(property)
      && !(property === 'animation-timing-function'
        && declaration.parent?.type === 'rule'
        && isInsideKeyframes(declaration.parent))) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_LONGHAND_UNSUPPORTED',
        'Animation longhands are unsupported in this import version.', declaration);
    }
  });
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    if (name === 'import') {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
        'External CSS resources are not supported.', atRule);
    }
    if (isPrefixedKeyframes(name)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_PREFIXED_MOTION_UNSUPPORTED',
        'Vendor-prefixed motion declarations are not supported.', atRule);
    }
    if ((atRule.name === 'media' || atRule.name === 'supports' || atRule.name === 'container')
      && containsMotion(atRule)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_RESPONSIVE_MOTION',
        'Conditional motion overrides are deferred.', atRule);
    }
  });
  root.walkDecls((declaration) => {
    if (/url\(\s*(?!["']?data:)/i.test(declaration.value)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
        'External CSS resources are not supported.', declaration);
    }
  });
}

export function addCssDiagnostic(
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
  code: string,
  summary: string,
  node: postcss.Node,
  unsupported = true,
): void {
  const locationNode = node.source?.start ? {
    sourceCodeLocation: {
      startLine: node.source.start.line,
      startCol: node.source.start.column,
      startOffset: 0,
      endLine: node.source.end?.line ?? node.source.start.line,
      endCol: node.source.end?.column ?? node.source.start.column,
      endOffset: 0,
    },
  } : undefined;
  addDiagnostic(diagnostics, inventory, code, summary, locationNode, unsupported);
}

export function addDiagnostic(
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
  code: string,
  summary: string,
  node?: { sourceCodeLocation?: { startLine: number; startCol: number } | null },
  unsupported = true,
): void {
  const diagnostic: Diagnostic = {
    code,
    severity: 'error',
    summary,
    ...(node?.sourceCodeLocation ? {
      line: node.sourceCodeLocation.startLine,
      column: node.sourceCodeLocation.startCol,
    } : {}),
  };
  if (!diagnostics.some((existing) => existing.code === code
    && existing.line === diagnostic.line && existing.column === diagnostic.column)) {
    diagnostics.push(diagnostic);
    inventory.diagnosticCodes.push(code);
    if (unsupported) inventory.unsupportedCount += 1;
  }
}

export function failedResult(diagnostics: Diagnostic[], inventory: MutableInventory): ImportResult {
  return { document: null, diagnostics, inventory: { ...inventory } };
}

export function descendants(root: ParentNode): Element[] {
  const result: Element[] = [];
  const visit = (node: AnyNode): void => {
    if (isTag(node)) result.push(node);
    if ('children' in node) for (const child of node.children) visit(child);
  };
  for (const child of root.children) visit(child);
  return result;
}

export function fingerprint(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const parent: ParentNode | null = current.parent;
    const siblings = parent && 'children' in parent
      ? parent.children.filter(isTag).filter((sibling) => sibling.name === current!.name)
      : [current];
    parts.push(`${current.name}[${siblings.indexOf(current)}]`);
    current = parent && isTag(parent) ? parent : null;
  }
  return parts.reverse().join('/');
}

export function removeElement(element: Element): void {
  const parent = element.parent;
  if (!parent || !('children' in parent)) return;
  const index = parent.children.indexOf(element);
  if (index >= 0) parent.children.splice(index, 1);
}

export function inspectStructuralAttributes(
  element: Element,
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
): void {
  const elementName = element.name.toLowerCase();
  if (['animate', 'animatemotion', 'animatetransform', 'set', 'marquee'].includes(elementName)) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_DECLARATIVE_MOTION_UNSUPPORTED',
      'Declarative motion elements are not supported.', element);
  }
  if (Object.keys(element.attribs).some((attribute) => /^on/i.test(attribute))) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_EVENT_HANDLER_UNSUPPORTED',
      'Inline event handlers are not supported.', element);
  }
  const javascriptUrlAttributes = [
    'href', 'xlink:href', 'src', 'srcset', 'poster', 'data', 'action', 'formaction',
    'ping', 'background', 'manifest', 'codebase', 'archive',
  ];
  if (javascriptUrlAttributes.some((attribute) =>
    element.attribs[attribute]?.trim().toLowerCase().startsWith('javascript:'))) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_JAVASCRIPT_URL_UNSUPPORTED',
      'Executable URL attributes are not supported.', element);
  }
  const style = element.attribs.style;
  if (style) {
    try {
      const root = postcss.parse(`x { ${style} }`);
      let inlineMotion = false;
      let inlineResource = false;
      root.walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        if (classifyMotionProperty(property) !== null) {
          inlineMotion = true;
        }
        valueParser(declaration.value).walk((node) => {
          if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
          const value = valueParser.stringify(node.nodes).trim().replace(/^["']|["']$/g, '');
          if (!value.startsWith('data:')) inlineResource = true;
        });
      });
      if (inlineMotion) {
        addDiagnostic(diagnostics, inventory, 'IMPORT_INLINE_MOTION_UNSUPPORTED',
          'Inline motion declarations are not supported.', element);
      }
      if (inlineResource) {
        addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
          'Inline resource references are not supported.', element);
      }
    } catch {
      addDiagnostic(diagnostics, inventory, 'IMPORT_INLINE_STYLE_INVALID',
        'An inline style could not be parsed structurally.', element);
    }
  }

  if (element.name === 'meta'
    && element.attribs['http-equiv']?.toLowerCase() === 'refresh') {
    addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
      'HTML refresh resources are not supported.', element);
  }
  const alwaysResourceAttributes = [
    'src', 'srcset', 'poster', 'action', 'formaction', 'ping', 'background', 'manifest',
    'codebase', 'archive',
  ];
  if (alwaysResourceAttributes.some((attribute) => attribute in element.attribs)) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
      'Resource-bearing HTML attributes are not supported.', element);
  }
  if ((element.name === 'use' || element.name === 'image')
    && ('href' in element.attribs || 'xlink:href' in element.attribs)) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
      'Linked SVG resources are not supported.', element);
  }
}

export function containsMotion(atRule: AtRule): boolean {
  let found = false;
  atRule.walkDecls((declaration) => {
    if (isMotionDeclaration(declaration.prop)) found = true;
  });
  return found;
}

export function isMotionDeclaration(property: string): boolean {
  return classifyMotionProperty(property) !== null;
}

export function classifyMotionProperty(property: string): 'animation' | 'transition' | 'prefixed' | null {
  const lower = property.toLowerCase();
  const prefix = /^-(?:webkit|moz|ms|o)-/.exec(lower);
  const unprefixed = prefix ? lower.slice(prefix[0].length) : lower;
  const animation = unprefixed === 'animation' || unprefixed.startsWith('animation-');
  const transition = unprefixed === 'transition' || unprefixed.startsWith('transition-');
  if (!animation && !transition) return null;
  if (prefix) return 'prefixed';
  return animation ? 'animation' : 'transition';
}

export function isPrefixedKeyframes(name: string): boolean {
  return /^-(?:webkit|moz|ms|o)-keyframes$/.test(name.toLowerCase());
}

export function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent as unknown as PostCssNode | undefined;
  while (parent) {
    if (parent.type === 'atrule' && isKeyframes(parent as AtRule)) return true;
    parent = parent.parent as unknown as PostCssNode | undefined;
  }
  return false;
}

export function hasConditionalAtRuleAncestor(rule: Rule): boolean {
  let parent = rule.parent as unknown as PostCssNode | undefined;
  while (parent) {
    if (parent.type === 'atrule'
      && ['media', 'supports', 'container'].includes((parent as AtRule).name)) return true;
    parent = parent.parent as unknown as PostCssNode | undefined;
  }
  return false;
}

export function isKeyframes(atRule: AtRule): boolean {
  return atRule.name.toLowerCase() === 'keyframes'
    || atRule.name.toLowerCase() === '-webkit-keyframes';
}

export function isTime(value: string): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/.test(value);
}

export function collectCustomProperties(root: postcss.Root): Map<string, string> {
  const properties = new Map<string, string>();
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) {
      properties.set(declaration.prop, declaration.value.trim());
    }
  });
  return properties;
}

export function collectMotionTimingCustomProperties(root: postcss.Root): Set<string> {
  const names = new Set<string>();
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    if (property !== 'animation' && property !== 'animation-delay') return;
    for (const match of declaration.value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      names.add(match[1]!);
    }
  });
  return names;
}

export function collectBindingDelayOverrides(
  root: postcss.Root,
  documentNode: ParentNode,
  customProperties: ReadonlyMap<string, string>,
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
): Map<Element, number[]> {
  const overrides = new Map<Element, number[]>();
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    const declaration = rule.nodes.find(
      (node): node is Declaration => node.type === 'decl'
        && node.prop.toLowerCase() === 'animation-delay',
    );
    if (!declaration) return;
    if (rule.selector.includes('::')) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_PSEUDO_ELEMENT_MOTION',
        'Pseudo-element animation applications are deferred.', rule);
      return;
    }
    let bound: Element[];
    try {
      bound = selectAll(rule.selector, documentNode.children);
    } catch {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_SELECTOR_UNSUPPORTED',
        'An animation binding selector is unsupported.', rule);
      return;
    }
    if (bound.length === 0) {
      inventory.missingCount += 1;
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_BINDING_MISSING',
        'An animation delay override could not bind to an element.', rule, false);
      return;
    }
    try {
      const delays = parseTimeList(declaration.value, customProperties);
      for (const element of bound) overrides.set(element, delays);
    } catch {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_AMBIGUOUS',
        'An animation delay could not be parsed unambiguously.', declaration);
    }
  });
  return overrides;
}

export function parseTimeList(
  value: string,
  customProperties: ReadonlyMap<string, string>,
): number[] {
  const parsed = valueParser(value);
  const groups: typeof parsed.nodes[] = [[]];
  for (const node of parsed.nodes) {
    if (node.type === 'div' && node.value === ',') groups.push([]);
    else groups.at(-1)!.push(node);
  }
  const result = groups.map((nodes) => {
    const token = valueParser.stringify(nodes).trim();
    const resolved = resolveTime(token, customProperties);
    if (resolved === null) throw new Error('unsupported animation delay');
    return resolved;
  });
  if (result.length === 0) throw new Error('empty animation delay');
  return result;
}

export function resolveTime(
  token: string,
  customProperties: ReadonlyMap<string, string>,
): number | null {
  if (isTime(token)) return parseTime(token);
  const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(token);
  if (!variable) return null;
  const resolved = customProperties.get(variable[1]!);
  return resolved && isTime(resolved) ? parseTime(resolved) : null;
}

export function parseTime(value: string): number {
  const amount = Number(value.endsWith('ms') ? value.slice(0, -2) : value.slice(0, -1))
    * (value.endsWith('ms') ? 1 : 1000);
  if (!Number.isInteger(amount)) throw new Error('timing must resolve to integer milliseconds');
  return amount;
}

export function stableId(prefix: string, input: string): string {
  return `${prefix}_${digest(input).slice(0, 16)}`;
}

export function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export {
  materializeOfflineFontResources,
  type FontMaterializationInput,
  type FontMaterializationProvenance,
  type FontMaterializationResult,
} from './materialize.js';
