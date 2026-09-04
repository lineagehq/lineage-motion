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

export type ParsedSlot = MotionDocument['applications'][number]['slots'][number];
export type MutableInventory = Omit<ImportInventory, 'diagnosticCodes'> & {
  diagnosticCodes: string[];
};

export const directionValues = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);
export const fillValues = new Set(['none', 'forwards', 'backwards', 'both']);
export const playValues = new Set(['running', 'paused']);
export const animationLonghandProperties = [
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',
] as const;
export type AnimationLonghandProperty = typeof animationLonghandProperties[number];
export const animationLonghandPropertySet = new Set<string>(animationLonghandProperties);

export function importMotionHtml(
  source: string,
  materialization?: FontMaterializationProvenance,
  v3Identity?: V3ImportIdentity,
): ImportResult {
  const sourceDigest = digest(source);
  const documentNode = parse(source, {
    treeAdapter,
    sourceCodeLocationInfo: true,
  }) as unknown as ParentNode;
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

export * from './css-parser.js';
import { extractReducedMotionRules, collectLonghandApplications, parseKeyframeRules, parseAnimationShorthand, parseOffsets } from './css-parser.js';

export * from './import-utilities.js';
import { detectUnsupportedCss, addCssDiagnostic, addDiagnostic, failedResult, descendants, fingerprint, removeElement, inspectStructuralAttributes, containsMotion, isMotionDeclaration, classifyMotionProperty, isPrefixedKeyframes, isInsideKeyframes, hasConditionalAtRuleAncestor, isKeyframes, isTime, collectCustomProperties, collectMotionTimingCustomProperties, collectBindingDelayOverrides, parseTimeList, resolveTime, parseTime, stableId, digest } from './import-utilities.js';
