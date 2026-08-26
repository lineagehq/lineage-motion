import { createHash } from 'node:crypto';

import { selectAll } from 'css-select';
import type { AnyNode, Element, ParentNode } from 'domhandler';
import { isTag } from 'domhandler';
import { parse, serialize } from 'parse5';
import { adapter as treeAdapter } from 'parse5-htmlparser2-tree-adapter';
import postcss, {
  type AtRule,
  type Declaration,
  type Node as PostCssNode,
  type Rule,
} from 'postcss';
import valueParser from 'postcss-value-parser';

import {
  classifyReducedMotionDeclaration,
  classifyAnimatedProperty,
  deriveElementId,
  parseCssTimingFunction,
  projectTrackInterpolation,
  serializeCssTimingFunction,
  validateMotionDocument,
  type Diagnostic,
  type MotionDocument,
  type RuleTrack,
  type TimingFunction,
} from '../../domain/src/index.js';
import type { FontMaterializationProvenance } from './materialize.js';

export const IMPORTER_VERSION = 'css-import.v1';

export type ImportInventory = MotionDocument['inventory'];
export type ImportResult = {
  document: MotionDocument | null;
  diagnostics: Diagnostic[];
  inventory: ImportInventory;
};
export type V3ImportIdentity = Readonly<{
  captureNamespaceSha256: string;
  admissionPackageSha256: string;
  provenance: readonly Readonly<{ stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }>[];
}>;

type ParsedSlot = MotionDocument['applications'][number]['slots'][number];
type MutableInventory = Omit<ImportInventory, 'diagnosticCodes'> & {
  diagnosticCodes: string[];
};

const directionValues = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);
const fillValues = new Set(['none', 'forwards', 'backwards', 'both']);
const playValues = new Set(['running', 'paused']);
const animationLonghandProperties = [
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',
] as const;
type AnimationLonghandProperty = typeof animationLonghandProperties[number];
const animationLonghandPropertySet = new Set<string>(animationLonghandProperties);

export function importMotionHtml(
  source: string,
  materialization?: FontMaterializationProvenance,
  v3Identity?: V3ImportIdentity,
): ImportResult {
  const sourceDigest = digest(source);
  const documentNode = parse(source, {
    treeAdapter,
    sourceCodeLocationInfo: true,
  });
  const diagnostics: Diagnostic[] = [];
  const inventory: MutableInventory = {
    sourceDigest,
    ruleCount: 0,
    applicationCount: 0,
    slotCount: 0,
    trackCount: 0,
    supportedCount: 0,
    unsupportedCount: 0,
    missingCount: 0,
    diagnosticCodes: [],
  };
  if (materialization && materialization.materializedSourceDigest !== sourceDigest) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_MATERIALIZED_DIGEST_MISMATCH',
      'Materialized source bytes do not match their provenance.');
    return failedResult(diagnostics, inventory);
  }
  if (v3Identity && (!/^[a-f0-9]{64}$/.test(v3Identity.captureNamespaceSha256)
    || !/^[a-f0-9]{64}$/.test(v3Identity.admissionPackageSha256)
    || v3Identity.provenance.length === 0
    || v3Identity.provenance.some((item) => item.captureNamespaceSha256 !== v3Identity.captureNamespaceSha256)
    || new Set(v3Identity.provenance.map((item) => item.stableId)).size !== v3Identity.provenance.length)) {
    addDiagnostic(diagnostics, inventory, 'IMPORT_V3_PROVENANCE_INVALID', 'The active-v3 provenance envelope is invalid.');
    return failedResult(diagnostics, inventory);
  }

  const elements = descendants(documentNode);
  for (const element of elements) {
    if (element.name === 'link' && element.attribs.href) {
      addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
        'External resources are not supported.', element);
    }
    if (element.name === 'script') {
      addDiagnostic(diagnostics, inventory, 'IMPORT_SCRIPT_UNSUPPORTED',
        'Scripts are not supported.', element);
    }
    if (['iframe', 'frame', 'object', 'embed', 'base'].includes(element.name)) {
      addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
        'Resource-loading HTML elements are not supported.', element);
    }
    if (
      (element.name === 'img' || element.name === 'video' || element.name === 'audio' || element.name === 'source')
      && element.attribs.src
    ) {
      addDiagnostic(diagnostics, inventory, 'IMPORT_EXTERNAL_RESOURCE',
        'External resources are not supported.', element);
    }
    inspectStructuralAttributes(element, diagnostics, inventory);
  }

  const styleElements = elements.filter((element) => element.name === 'style');
  const cssSource = styleElements
    .flatMap((element) => element.children)
    .filter((node) => node.type === 'text')
    .map((node) => node.data)
    .join('\n');

  let cssRoot: postcss.Root;
  try {
    cssRoot = postcss.parse(cssSource);
  } catch {
    addDiagnostic(diagnostics, inventory, 'IMPORT_CSS_PARSE_FAILED',
      'CSS could not be parsed structurally.');
    return failedResult(diagnostics, inventory);
  }

  const reducedMotionRules = extractReducedMotionRules(cssRoot, diagnostics, inventory);

  detectUnsupportedCss(cssRoot, diagnostics, inventory);
  const customProperties = collectCustomProperties(cssRoot);
  const motionTimingCustomProperties = collectMotionTimingCustomProperties(cssRoot);
  const bindingDelayOverrides = collectBindingDelayOverrides(
    cssRoot,
    documentNode,
    customProperties,
    diagnostics,
    inventory,
  );
  const rules = parseKeyframeRules(cssRoot, diagnostics, inventory);
  const ruleByName = new Map(rules.map((rule) => [rule.sourceName, rule]));
  const longhandApplications = collectLonghandApplications(
    cssRoot, documentNode, diagnostics, inventory,
  );
  const canonicalElements = new Map<Element, MotionDocument['elements'][number]>();
  const applications: MotionDocument['applications'] = [];
  const elementTracks: MotionDocument['tracks'] = [];
  const shorthandElements = new Set<Element>();

  const ensureCanonicalElement = (element: Element, selectorHint: string, sourceRule: Rule) => {
    let canonicalElement = canonicalElements.get(element);
    if (canonicalElement) return canonicalElement;
    const structuralFingerprint = fingerprint(element);
    const stableIdentity = element.attribs['data-motion-stable'];
    const nodeProvenance = element.attribs['data-motion-provenance'];
    const proven = v3Identity?.provenance.find((item) => item.stableId === stableIdentity);
    if (v3Identity && (!stableIdentity || !nodeProvenance || !proven
      || proven.nodeProvenanceSha256 !== nodeProvenance)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_V3_PROVENANCE_UNBOUND',
        'An animated target is not bound to authenticated v3 node provenance.', sourceRule);
      return null;
    }
    canonicalElement = {
      id: v3Identity ? deriveElementId(`${v3Identity.captureNamespaceSha256}\0${nodeProvenance}`, 0)
        : deriveElementId(structuralFingerprint, 0),
      selectorHint,
      structuralFingerprint,
    };
    canonicalElements.set(element, canonicalElement);
    element.attribs['data-motion-id'] = canonicalElement.id;
    return canonicalElement;
  };

  const appendApplication = (
    bound: Element[],
    boundCanonicalElements: MotionDocument['elements'],
    selectorHint: string,
    slots: Omit<ParsedSlot, 'id'>[],
    sourceNode: Declaration,
  ) => {
    const applicationId = stableId('app', JSON.stringify({
      elements: boundCanonicalElements.map((element) => element.id).sort(),
      slots: slots.map((slot) => ({
        ...slot, timingFunction: serializeCssTimingFunction(slot.timingFunction),
      })),
    }));
    const applicationSlots: ParsedSlot[] = [];
    for (const parsedSlot of slots) {
      const rule = ruleByName.get(parsedSlot.ruleId);
      if (!rule) {
        inventory.missingCount += 1;
        addCssDiagnostic(diagnostics, inventory, 'IMPORT_RULE_MISSING',
          'An animation application references an unknown keyframe rule.', sourceNode, false);
        continue;
      }
      const slotId = stableId('slot', JSON.stringify({ applicationId, ruleId: rule.id,
        slot: { ...parsedSlot,
          timingFunction: serializeCssTimingFunction(parsedSlot.timingFunction) } }));
      const slot = { ...parsedSlot, id: slotId, ruleId: rule.id };
      applicationSlots.push(slot);
      for (const canonicalElement of boundCanonicalElements) {
        for (const ruleTrack of rule.tracks) {
          elementTracks.push({
            id: stableId('track', `${canonicalElement.id}\0${slotId}\0${ruleTrack.property}`),
            elementId: canonicalElement.id,
            ruleId: rule.id,
            slotId,
            property: ruleTrack.property,
            interpolation: projectTrackInterpolation(ruleTrack.property, slot.timingFunction),
            keyframeIds: ruleTrack.keyframes.map((keyframe) => keyframe.id),
          });
        }
      }
    }
    if (applicationSlots.length > 0) {
      applications.push({
        id: applicationId,
        bindings: boundCanonicalElements.map((element, index) => ({
          elementId: element.id,
          delayOverridesMs: bindingDelayOverrides.get(bound[index]!)
            ?? applicationSlots.map((slot) => slot.delayMs),
        })),
        selectorHint,
        slots: applicationSlots,
      });
    }
  };

  cssRoot.walkRules((cssRule) => {
    if (isInsideKeyframes(cssRule)) return;
    const animationDeclaration = cssRule.nodes.find(
      (node): node is Declaration => node.type === 'decl' && node.prop.toLowerCase() === 'animation',
    );
    if (!animationDeclaration) return;
    if (cssRule.selector.includes('::')) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_PSEUDO_ELEMENT_MOTION',
        'Pseudo-element animation applications are deferred.', cssRule);
      return;
    }
    if (hasConditionalAtRuleAncestor(cssRule)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_RESPONSIVE_MOTION',
        'Conditional motion overrides are deferred.', cssRule);
      return;
    }

    let bound: Element[];
    try {
      bound = selectAll(cssRule.selector, documentNode.children);
    } catch {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_SELECTOR_UNSUPPORTED',
        'An animation binding selector is unsupported.', cssRule);
      return;
    }
    if (bound.length === 0) {
      inventory.missingCount += 1;
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_BINDING_MISSING',
        'An animation application could not bind to an element.', cssRule, false);
      return;
    }

    let slots: Omit<ParsedSlot, 'id'>[];
    try {
      slots = parseAnimationShorthand(animationDeclaration.value, customProperties);
      const delayDeclaration = cssRule.nodes.find(
        (node): node is Declaration => node.type === 'decl'
          && node.prop.toLowerCase() === 'animation-delay',
      );
      if (delayDeclaration) {
        const delays = parseTimeList(delayDeclaration.value, customProperties);
        slots = slots.map((slot, index) => ({
          ...slot,
          delayMs: delays[index % delays.length]!,
        }));
      }
    } catch {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_AMBIGUOUS',
        'An animation shorthand could not be parsed unambiguously.', animationDeclaration);
      return;
    }

    const boundCanonicalElements: MotionDocument['elements'] = [];
    for (const element of bound) {
      shorthandElements.add(element);
      const canonicalElement = ensureCanonicalElement(element, cssRule.selector, cssRule);
      if (canonicalElement) boundCanonicalElements.push(canonicalElement);
    }
    appendApplication(bound, boundCanonicalElements, cssRule.selector, slots, animationDeclaration);
  });

  for (const longhand of longhandApplications) {
    if (shorthandElements.has(longhand.element)) {
      addCssDiagnostic(diagnostics, inventory, 'IMPORT_ANIMATION_LONGHAND_INVALID',
        'Animation shorthand and complete longhands cannot target the same element.',
        longhand.sourceRule);
      continue;
    }
    const canonicalElement = ensureCanonicalElement(
      longhand.element, longhand.selectorHint, longhand.sourceRule,
    );
    if (canonicalElement) appendApplication(
      [longhand.element], [canonicalElement], longhand.selectorHint,
      [longhand.slot], longhand.sourceDeclaration,
    );
  }

  inventory.ruleCount = rules.length;
  inventory.applicationCount = applications.length;
  inventory.slotCount = applications.reduce((sum, application) => sum + application.slots.length, 0);
  inventory.trackCount = elementTracks.length;
  inventory.supportedCount = inventory.ruleCount + inventory.applicationCount
    + inventory.slotCount + inventory.trackCount;

  const boundApplicationElements = new Set(applications.flatMap((application) =>
    application.bindings.map((binding) => binding.elementId),
  ));
  for (const element of bindingDelayOverrides.keys()) {
    const canonical = canonicalElements.get(element);
    if (!canonical || !boundApplicationElements.has(canonical.id)) {
      addDiagnostic(diagnostics, inventory, 'IMPORT_DELAY_WITHOUT_APPLICATION',
        'An animation delay override has no structured application.');
      break;
    }
  }

  const presentationRoot = cssRoot.clone();
  presentationRoot.walkAtRules((atRule) => {
    if (isKeyframes(atRule)) atRule.remove();
  });
  presentationRoot.walkDecls((declaration) => {
    if (isMotionDeclaration(declaration.prop)
      || motionTimingCustomProperties.has(declaration.prop)) declaration.remove();
  });
  presentationRoot.walkRules((cssRule) => {
    if (cssRule.nodes.length === 0) cssRule.remove();
  });
  for (const styleElement of styleElements) removeElement(styleElement);

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return failedResult(diagnostics, inventory);
  }

  const durationMs = applications.reduce((maximum, application) => Math.max(
    maximum,
    ...application.bindings.flatMap((binding) => application.slots.map((slot, slotIndex) =>
      binding.delayOverridesMs[slotIndex]! + slot.durationMs * (
        slot.iterationCount === 'infinite' ? 1 : slot.iterationCount
      ),
    )),
  ), 0);
  const motionDocument: MotionDocument = {
    schemaVersion: 'motion.document.v1',
    documentId: stableId('doc', sourceDigest),
    revision: 0,
    durationMs,
    presentation: {
      html: serialize(documentNode, { treeAdapter }),
      css: `${presentationRoot.toString().trim()}\n`,
    },
    elements: [...canonicalElements.values()],
    rules,
    applications,
    tracks: elementTracks,
    cues: [],
    inventory: { ...inventory },
    provenance: { ...(materialization ? {
      sourceKind: 'offline-font-materialized',
      ...materialization,
    } : {
      sourceKind: 'direct',
      originalSourceDigest: sourceDigest,
      materializedSourceDigest: sourceDigest,
      resourceLockDigest: null,
      stylesheetDigest: null,
      aggregateFontAssetDigest: null,
      fontAssetCount: 0,
    }), ...(v3Identity ? { captureNamespaceSha256: v3Identity.captureNamespaceSha256,
      admissionPackageSha256: v3Identity.admissionPackageSha256 } : {}) },
    reducedMotion: { mode: 'source-snapshot', css: reducedMotionRules.join('\n') },
  };
  const validation = validateMotionDocument(motionDocument);
  if (!validation.ok) {
    for (const diagnostic of validation.diagnostics) {
      addDiagnostic(diagnostics, inventory, diagnostic.code, diagnostic.summary, undefined, false);
    }
    return failedResult(diagnostics, inventory);
  }

  return { document: motionDocument, diagnostics, inventory: { ...inventory } };
}

function extractReducedMotionRules(
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

type LonghandApplication = {
  element: Element;
  selectorHint: string;
  sourceRule: Rule;
  sourceDeclaration: Declaration;
  slot: Omit<ParsedSlot, 'id'>;
};

function collectLonghandApplications(
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

function parseKeyframeRules(
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

function parseAnimationShorthand(
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

function parseOffsets(selector: string): number[] | null {
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

function detectUnsupportedCss(
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

function addCssDiagnostic(
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

function addDiagnostic(
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

function failedResult(diagnostics: Diagnostic[], inventory: MutableInventory): ImportResult {
  return { document: null, diagnostics, inventory: { ...inventory } };
}

function descendants(root: ParentNode): Element[] {
  const result: Element[] = [];
  const visit = (node: AnyNode): void => {
    if (isTag(node)) result.push(node);
    if ('children' in node) for (const child of node.children) visit(child);
  };
  for (const child of root.children) visit(child);
  return result;
}

function fingerprint(element: Element): string {
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

function removeElement(element: Element): void {
  const parent = element.parent;
  if (!parent || !('children' in parent)) return;
  const index = parent.children.indexOf(element);
  if (index >= 0) parent.children.splice(index, 1);
}

function inspectStructuralAttributes(
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

function containsMotion(atRule: AtRule): boolean {
  let found = false;
  atRule.walkDecls((declaration) => {
    if (isMotionDeclaration(declaration.prop)) found = true;
  });
  return found;
}

function isMotionDeclaration(property: string): boolean {
  return classifyMotionProperty(property) !== null;
}

function classifyMotionProperty(property: string): 'animation' | 'transition' | 'prefixed' | null {
  const lower = property.toLowerCase();
  const prefix = /^-(?:webkit|moz|ms|o)-/.exec(lower);
  const unprefixed = prefix ? lower.slice(prefix[0].length) : lower;
  const animation = unprefixed === 'animation' || unprefixed.startsWith('animation-');
  const transition = unprefixed === 'transition' || unprefixed.startsWith('transition-');
  if (!animation && !transition) return null;
  if (prefix) return 'prefixed';
  return animation ? 'animation' : 'transition';
}

function isPrefixedKeyframes(name: string): boolean {
  return /^-(?:webkit|moz|ms|o)-keyframes$/.test(name.toLowerCase());
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent as unknown as PostCssNode | undefined;
  while (parent) {
    if (parent.type === 'atrule' && isKeyframes(parent as AtRule)) return true;
    parent = parent.parent as unknown as PostCssNode | undefined;
  }
  return false;
}

function hasConditionalAtRuleAncestor(rule: Rule): boolean {
  let parent = rule.parent as unknown as PostCssNode | undefined;
  while (parent) {
    if (parent.type === 'atrule'
      && ['media', 'supports', 'container'].includes((parent as AtRule).name)) return true;
    parent = parent.parent as unknown as PostCssNode | undefined;
  }
  return false;
}

function isKeyframes(atRule: AtRule): boolean {
  return atRule.name.toLowerCase() === 'keyframes'
    || atRule.name.toLowerCase() === '-webkit-keyframes';
}

function isTime(value: string): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/.test(value);
}

function collectCustomProperties(root: postcss.Root): Map<string, string> {
  const properties = new Map<string, string>();
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) {
      properties.set(declaration.prop, declaration.value.trim());
    }
  });
  return properties;
}

function collectMotionTimingCustomProperties(root: postcss.Root): Set<string> {
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

function collectBindingDelayOverrides(
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

function parseTimeList(
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

function resolveTime(
  token: string,
  customProperties: ReadonlyMap<string, string>,
): number | null {
  if (isTime(token)) return parseTime(token);
  const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(token);
  if (!variable) return null;
  const resolved = customProperties.get(variable[1]!);
  return resolved && isTime(resolved) ? parseTime(resolved) : null;
}

function parseTime(value: string): number {
  const amount = Number(value.endsWith('ms') ? value.slice(0, -2) : value.slice(0, -1))
    * (value.endsWith('ms') ? 1 : 1000);
  if (!Number.isInteger(amount)) throw new Error('timing must resolve to integer milliseconds');
  return amount;
}

function stableId(prefix: string, input: string): string {
  return `${prefix}_${digest(input).slice(0, 16)}`;
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export {
  materializeOfflineFontResources,
  type FontMaterializationInput,
  type FontMaterializationProvenance,
  type FontMaterializationResult,
} from './materialize.js';
