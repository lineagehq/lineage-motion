import { selectAll } from 'css-select';
import type { Element, ParentNode } from 'domhandler';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import valueParser from 'postcss-value-parser';
import { classifyAnimatedProperty, classifyReducedMotionDeclaration, parseCssTimingFunction, serializeCssTimingFunction, type Diagnostic, type MotionDocument, type RuleTrack, type TimingFunction } from '../../domain/src/index.js';
import { animationLonghandProperties, animationLonghandPropertySet, directionValues, fillValues, playValues, type AnimationLonghandProperty, type MutableInventory, type ParsedSlot } from './index.js';
import {
  addCssDiagnostic, hasConditionalAtRuleAncestor, isInsideKeyframes, isKeyframes,
  parseTime, parseTimeList, resolveTime, stableId,
} from './import-utilities.js';

export function extractReducedMotionRules(
  root: postcss.Root,
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
): string[] {
  const snapshots: string[] = [];
  root.walkAtRules('media', (atRule) => {
    if (!/^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i.test(atRule.params)) return;
    let registeredMotionCount = 0;
    let invalid = false;
    atRule.walkAtRules(() => { invalid = true; });
    atRule.walkRules((rule) => {
      if (rule.selector.includes('::')) invalid = true;
    });
    atRule.walkDecls((declaration) => {
      const kind = classifyReducedMotionDeclaration(
        declaration.prop,
        declaration.value,
        declaration.important,
      );
      if (kind === 'animation-none' || kind === 'animation-duration'
        || kind === 'animation-timing-function') {
        registeredMotionCount += 1;
      } else if (kind === null) {
        invalid = true;
      }
    });
    if (invalid || registeredMotionCount === 0) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_RESPONSIVE_MOTION',
        'Reduced-motion branches must contain only registered animation overrides.', atRule);
      return;
    }
    snapshots.push(atRule.toString());
    atRule.remove();
  });
  return snapshots;
}

export type LonghandApplication = {
  element: Element;
  selectorHint: string;
  sourceRule: Rule;
  sourceDeclaration: Declaration;
  slot: Omit<ParsedSlot, 'id'>;
};

export function collectLonghandApplications(
  root: postcss.Root,
  documentNode: ParentNode,
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
): LonghandApplication[] {
  const declarationsByElement = new Map<Element, Map<AnimationLonghandProperty, Declaration>>();
  const selectorsByElement = new Map<Element, { selector: string; rule: Rule }>();
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule) || hasConditionalAtRuleAncestor(rule)) return;
    const declarations = rule.nodes.filter((node): node is Declaration =>
      node.type === 'decl' && animationLonghandPropertySet.has(node.prop.toLowerCase()));
    if (declarations.length === 0) return;
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
        'An animation longhand could not bind to an element.', rule, false);
      return;
    }
    for (const declaration of declarations) {
      const property = declaration.prop.toLowerCase() as AnimationLonghandProperty;
      const value = declaration.value.trim();
      for (const element of bound) {
        const byProperty = declarationsByElement.get(element) ?? new Map();
        const existing = byProperty.get(property);
        if (existing && existing.value.trim() !== value) {
          addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_LONGHAND_CONFLICT',
            'Conflicting animation longhands target the same element.', declaration);
          continue;
        }
        byProperty.set(property, declaration);
        declarationsByElement.set(element, byProperty);
        selectorsByElement.set(element, { selector: rule.selector, rule });
      }
    }
  });

  const applications: LonghandApplication[] = [];
  for (const [element, declarations] of declarationsByElement) {
    // A delay by itself is the existing element-bound override, not an application tuple.
    if (declarations.size === 1 && declarations.has('animation-delay')) continue;
    const source = selectorsByElement.get(element)!;
    if (animationLonghandProperties.some((property) => !declarations.has(property))) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_LONGHAND_INCOMPLETE',
        'Animation longhand applications must provide one complete legacy tuple.', source.rule);
      continue;
    }
    const invalidDeclaration = [...declarations.values()].find((declaration) => {
      const value = declaration.value.trim();
      return declaration.important || valueParser(value).nodes.some((node) =>
        node.type === 'div' && node.value === ',')
        || /\b(?:var|env)\s*\(/i.test(value)
        || /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value);
    });
    if (invalidDeclaration) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_LONGHAND_INVALID',
        'Animation longhands must use one explicit non-cascading value.', invalidDeclaration);
      continue;
    }
    try {
      const value = (property: AnimationLonghandProperty) =>
        declarations.get(property)!.value.trim();
      const durationMs = parseTime(value('animation-duration'));
      const delayMs = parseTime(value('animation-delay'));
      const iterationRaw = value('animation-iteration-count').toLowerCase();
      const iterationCount = iterationRaw === 'infinite' ? 'infinite'
        : /^(?:\d+|\d*\.\d+)$/.test(iterationRaw) ? Number(iterationRaw) : NaN;
      const direction = value('animation-direction').toLowerCase();
      const fillMode = value('animation-fill-mode').toLowerCase();
      const playState = value('animation-play-state').toLowerCase();
      const name = value('animation-name');
      if (durationMs < 0 || (iterationCount !== 'infinite'
        && (!Number.isFinite(iterationCount) || iterationCount < 0))
        || !directionValues.has(direction) || !fillValues.has(fillMode)
        || !playValues.has(playState) || !/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(name)
        || name.toLowerCase() === 'none') throw new Error('invalid longhand tuple');
      applications.push({
        element,
        selectorHint: source.selector,
        sourceRule: source.rule,
        sourceDeclaration: declarations.get('animation-name')!,
        slot: {
          ruleId: name,
          durationMs,
          delayMs,
          iterationCount,
          direction: direction as ParsedSlot['direction'],
          fillMode: fillMode as ParsedSlot['fillMode'],
          playState: playState as ParsedSlot['playState'],
          timingFunction: parseCssTimingFunction(value('animation-timing-function')),
        },
      });
    } catch {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_LONGHAND_INVALID',
        'An animation longhand tuple could not be parsed exactly.', source.rule);
    }
  }
  return applications;
}

export function parseKeyframeRules(
  root: postcss.Root,
  diagnostics: Diagnostic[],
  inventory: MutableInventory,
): MotionDocument['rules'] {
  const rules: MotionDocument['rules'] = [];
  const seenNames = new Set<string>();
  root.walkAtRules((atRule) => {
    if (!isKeyframes(atRule)) return;
    const sourceName = atRule.params.trim();
    if (!sourceName || seenNames.has(sourceName)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_RULE_IDENTITY_INVALID',
        'Keyframe rule identity is missing or duplicated.', atRule);
      return;
    }
    seenNames.add(sourceName);
    const ruleId = stableId('rule', sourceName);
    const propertyFrames = new Map<string, Array<{ offset: number; value: string; easing?: TimingFunction }>>();
    atRule.each((node) => {
      if (node.type !== 'rule') return;
      const offsets = parseOffsets(node.selector);
      if (offsets === null) {
        addCssDiagnostic(diagnostics, inventory, 'IMPORT_KEYFRAME_OFFSET_INVALID',
          'A keyframe offset is unsupported.', node);
        return;
      }
      const easingDeclaration = node.nodes.find(
        (child): child is Declaration => child.type === 'decl'
          && child.prop.toLowerCase() === 'animation-timing-function',
      );
      let easing: TimingFunction | undefined;
      if (easingDeclaration) {
        try {
          easing = parseCssTimingFunction(easingDeclaration.value);
        } catch {
          addCssDiagnostic(diagnostics, inventory, 'IMPORT_TIMING_UNSUPPORTED',
            'A keyframe timing function is unsupported.', easingDeclaration);
        }
      }
      for (const declaration of node.nodes) {
        if (declaration.type !== 'decl' || declaration.prop.toLowerCase() === 'animation-timing-function') continue;
        const property = declaration.prop.toLowerCase();
        const frames = propertyFrames.get(property) ?? [];
        for (const offset of offsets) {
          const existing = frames.find((frame) => frame.offset === offset);
          if (existing && existing.value !== declaration.value) {
            addCssDiagnostic(diagnostics, inventory, 'IMPORT_KEYFRAME_CONFLICT',
              'Conflicting declarations share a keyframe offset.', declaration);
            continue;
          }
          if (!existing) frames.push({ offset, value: declaration.value, ...(easing ? { easing } : {}) });
        }
        propertyFrames.set(property, frames);
      }
    });
    const tracks: RuleTrack[] = [];
    for (const [property, frames] of propertyFrames.entries()) {
      const interpolation = classifyAnimatedProperty(property);
      if (!interpolation) {
        addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATED_PROPERTY_UNSUPPORTED',
          'An animated property is not registered by motion.css-motion-semantics.v1.', atRule);
        continue;
      }
      tracks.push({
        id: stableId('rule_track', `${ruleId}\0${property}`), property, interpolation,
        keyframes: frames.sort((a, b) => a.offset - b.offset).map((frame) => ({
          id: stableId('kf', `${ruleId}\0${property}\0${frame.offset}`), offset: frame.offset,
          value: frame.value, ...(frame.easing ? { easing: frame.easing } : {}),
        })),
      });
    }
    if (tracks.length === 0) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_RULE_EMPTY',
        'A keyframe rule contains no supported property tracks.', atRule);
      return;
    }
    rules.push({ id: ruleId, sourceName, tracks });
  });
  return rules;
}

export function parseAnimationShorthand(
  value: string,
  customProperties: ReadonlyMap<string, string>,
): Omit<ParsedSlot, 'id'>[] {
  const parsed = valueParser(value);
  const groups: typeof parsed.nodes[] = [[]];
  for (const node of parsed.nodes) {
    if (node.type === 'div' && node.value === ',') groups.push([]);
    else groups.at(-1)!.push(node);
  }
  return groups.map((nodes) => {
    const tokens = nodes
      .filter((node) => node.type !== 'space' && node.type !== 'comment')
      .map((node) => valueParser.stringify(node));
    let name: string | undefined;
    const times: number[] = [];
    let timingFunction: TimingFunction = { kind: 'keyword', value: 'ease' };
    let iterationCount: number | 'infinite' = 1;
    let direction: ParsedSlot['direction'] = 'normal';
    let fillMode: ParsedSlot['fillMode'] = 'none';
    let playState: ParsedSlot['playState'] = 'running';
    for (const token of tokens) {
      const resolvedTime = resolveTime(token, customProperties);
      if (resolvedTime !== null) {
        times.push(resolvedTime);
      } else if (/^(?:linear|ease(?:-in|-out|-in-out)?|steps\(|cubic-bezier\()/i.test(token)) {
        timingFunction = parseCssTimingFunction(token);
      } else if (token === 'infinite') {
        iterationCount = 'infinite';
      } else if (/^(?:\d+|\d*\.\d+)$/.test(token)) {
        iterationCount = Number(token);
      } else if (directionValues.has(token)) {
        direction = token as ParsedSlot['direction'];
      } else if (fillValues.has(token)) {
        fillMode = token as ParsedSlot['fillMode'];
      } else if (playValues.has(token)) {
        playState = token as ParsedSlot['playState'];
      } else if (!name && token !== 'none') {
        name = token;
      } else {
        throw new Error('ambiguous animation shorthand');
      }
    }
    if (!name || times.length > 2) throw new Error('missing animation name');
    return {
      ruleId: name,
      durationMs: times[0] ?? 0,
      delayMs: times[1] ?? 0,
      iterationCount,
      direction,
      fillMode,
      playState,
      timingFunction,
    };
  });
}

export function parseOffsets(selector: string): number[] | null {
  const offsets: number[] = [];
  for (const rawPart of selector.split(',')) {
    const part = rawPart.trim();
    if (part === 'from') offsets.push(0);
    else if (part === 'to') offsets.push(1);
    else if (/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(part)) offsets.push(Number(part.slice(0, -1)) / 100);
    else return null;
  }
  return offsets;
}
