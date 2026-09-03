import { createHash } from 'node:crypto';

import postcss, { type Declaration, type Rule } from 'postcss';

import type { MotionDocument } from '../../domain/src/index.js';
import { importMotionHtml, type ImportInventory } from './index.js';
import {
  materializeOfflineFontResources,
  type FontMaterializationInput,
} from './materialize.js';

export const FIVE_SCENE_CLOSURE_VERSION = 'motion.five-scene-closure.v1' as const;
export const FIVE_SCENE_ALIASES = [
  'scene-a', 'scene-b', 'scene-c', 'scene-d', 'scene-e',
] as const;
export type FiveSceneAlias = typeof FIVE_SCENE_ALIASES[number];

const categories = new Set(['cursor-path', 'click-pulse', 'reveal', 'type', 'select', 'drag', 'hold']);
const evidenceKinds = new Set([
  'position-trajectory', 'transform-pulse', 'progressive-reveal', 'stepped-text-progress',
  'discrete-visibility-boundary', 'stable-interval', 'target-proximity',
  'coincident-boundary', 'multi-element-synchrony',
]);

export type FiveSceneCandidateObservation = Readonly<{
  category: 'cursor-path' | 'click-pulse' | 'reveal' | 'type' | 'select' | 'drag' | 'hold';
  targetIds: readonly string[];
  startMs: number;
  endMs: number;
  evidenceKinds: readonly string[];
}>;

export type FiveSceneCandidate = Readonly<{
  id: string;
  sourceDigest: string;
  category: FiveSceneCandidateObservation['category'];
  targetIds: readonly string[];
  startMs: number;
  endMs: number;
  confidence: 'low' | 'medium' | 'high';
  evidenceKindCounts: Readonly<Record<string, number>>;
  evidenceCount: number;
}>;

export type SceneCInertCertificate = Readonly<{
  schemaVersion: 'motion.scene-c-inert-certificate.v1';
  sourceDigest: string;
  declarationOrdinal: number;
  declarationRemovedSourceDigest: string;
  staticScriptFree: boolean;
  targetPropertySetClosed: boolean;
  cascadeResolved: boolean;
  reachableStateProbeCount: number;
  zeroTransitionAnimations: boolean;
  exactRenderedEquality: boolean;
  unexpectedNetworkRequestCount: number;
}>;

export type SceneEProjection = Readonly<{
  originalSourceDigest: string;
  applicationOrdinals: readonly number[];
  expectedPseudoApplicationCount: number;
}>;

export type OwnerCorrection = Readonly<{
  originalSourceDigest: string;
  correctedSource: string;
  correctedSourceDigest: string;
}>;

export type FiveSceneInput = Readonly<{
  source?: string;
  fontMaterialization?: Omit<FontMaterializationInput, 'html'>;
  ownerCorrection?: OwnerCorrection;
  sceneCCertificate?: SceneCInertCertificate;
  sceneEProjection?: SceneEProjection;
  candidateObservations?: readonly FiveSceneCandidateObservation[];
}>;

export type FiveSceneResult = Readonly<{
  alias: FiveSceneAlias;
  outcome: 'imported' | 'projected' | 'deferred';
  document: MotionDocument | null;
  inventory: ImportInventory | null;
  diagnosticCodes: readonly string[];
  candidateStatus: 'available' | 'unavailable';
  candidateCount: number;
  candidates: readonly FiveSceneCandidate[];
  untouchedLedger?: Readonly<{ originalSourceDigest: string;
    diagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION'; applicationCount: number }>;
  projectionLedger?: Readonly<{ originalSourceDigest: string; projectedSourceDigest: string;
    removedApplicationCount: number; removedDiagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION';
    retainedApplicationCount: number }>;
}>;

export type FiveSceneClosure = Readonly<{
  scenes: readonly FiveSceneResult[];
  receipt: Readonly<{
    schemaVersion: 'motion.five-scene-closure-receipt.v1';
    runnerVersion: typeof FIVE_SCENE_CLOSURE_VERSION;
    aliasCount: 5;
    exercisedAliasCount: 5;
    importedAliasCount: number;
    projectedAliasCount: number;
    deferredAliasCount: number;
    candidateCount: number;
    candidateNoncanonical: true;
    zeroNetwork: true;
    scenes: readonly Readonly<{
      alias: FiveSceneAlias; outcome: FiveSceneResult['outcome']; originalSourceDigest: string | null;
      canonicalDocumentDigest: string | null; diagnosticCodes: readonly string[];
      candidateStatus: FiveSceneResult['candidateStatus']; candidateCount: number;
      untouchedPseudoApplicationCount: number; projectedPseudoApplicationCount: number;
    }>[];
  }>;
}>;

export function runFiveSceneClosure(input: Readonly<{
  scenes: Readonly<Record<FiveSceneAlias, FiveSceneInput>>;
}>): FiveSceneClosure {
  const scenes = FIVE_SCENE_ALIASES.map((alias) => processScene(alias, input.scenes[alias]));
  return { scenes, receipt: {
    schemaVersion: 'motion.five-scene-closure-receipt.v1',
    runnerVersion: FIVE_SCENE_CLOSURE_VERSION,
    aliasCount: 5,
    exercisedAliasCount: scenes.length as 5,
    importedAliasCount: scenes.filter(({ outcome }) => outcome === 'imported').length,
    projectedAliasCount: scenes.filter(({ outcome }) => outcome === 'projected').length,
    deferredAliasCount: scenes.filter(({ outcome }) => outcome === 'deferred').length,
    candidateCount: scenes.reduce((sum, scene) => sum + scene.candidateCount, 0),
    candidateNoncanonical: true,
    zeroNetwork: true,
    scenes: scenes.map((scene) => ({
      alias: scene.alias,
      outcome: scene.outcome,
      originalSourceDigest: input.scenes[scene.alias].source
        ? digest(input.scenes[scene.alias].source!) : null,
      canonicalDocumentDigest: scene.document ? digest(JSON.stringify(scene.document)) : null,
      diagnosticCodes: scene.diagnosticCodes,
      candidateStatus: scene.candidateStatus,
      candidateCount: scene.candidateCount,
      untouchedPseudoApplicationCount: scene.untouchedLedger?.applicationCount ?? 0,
      projectedPseudoApplicationCount: scene.projectionLedger?.removedApplicationCount ?? 0,
    })),
  } };
}

function processScene(alias: FiveSceneAlias, input: FiveSceneInput): FiveSceneResult {
  if (!input.source) return deferred(alias, ['IMPORT_ALIAS_UNAVAILABLE']);
  const originalSource = input.source;
  let source = originalSource;
  const preflightCodes: string[] = [];

  if (alias === 'scene-b') {
    const correction = input.ownerCorrection;
    if (!correction || correction.originalSourceDigest !== digest(source)
      || correction.correctedSourceDigest !== digest(correction.correctedSource)) {
      preflightCodes.push('IMPORT_RULE_MISSING');
    } else {
      source = correction.correctedSource;
    }
  }

  let materialization;
  if (input.fontMaterialization) {
    materialization = materializeOfflineFontResources({ html: source, ...input.fontMaterialization });
    if (!materialization.ok) {
      return deferred(alias, orderedCodes([...preflightCodes,
        ...materialization.diagnostics.map(({ code }) => code)]));
    }
    source = materialization.html;
  }

  let inertWarning = false;
  if (alias === 'scene-c' && containsTransition(source)) {
    const projected = certifySceneC(source, input.sceneCCertificate);
    if (!projected) {
      const imported = importMotionHtml(source);
      return deferred(alias, orderedCodes([...preflightCodes,
        ...imported.diagnostics.map(({ code }) => code)]), imported.inventory);
    }
    source = projected;
    inertWarning = true;
  }

  if (alias === 'scene-e') {
    const untouched = importMotionHtml(source, materialization?.ok ? materialization.provenance : undefined);
    const pseudoCount = countPseudoApplications(source);
    if (pseudoCount > 0) {
      const untouchedLedger = { originalSourceDigest: digest(originalSource),
        diagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION' as const, applicationCount: pseudoCount };
      const projection = projectSceneE(source, originalSource, input.sceneEProjection, pseudoCount);
      if (!projection) return { ...deferred(alias, orderedCodes([...preflightCodes,
        ...untouched.diagnostics.map(({ code }) => code)]), untouched.inventory), untouchedLedger };
      const projected = importMotionHtml(projection.source,
        materialization?.ok ? { ...materialization.provenance,
          materializedSourceDigest: digest(projection.source) } : undefined);
      if (!retainsNonPseudoInventory(untouched.inventory, projected.inventory)) {
        return { ...deferred(alias, orderedCodes([...preflightCodes,
          ...untouched.diagnostics.map(({ code }) => code), 'IMPORT_PROJECTION_INVALID']),
        projected.inventory), untouchedLedger };
      }
      const projectionLedger = { originalSourceDigest: digest(originalSource),
        projectedSourceDigest: digest(projection.source), removedApplicationCount: pseudoCount,
        removedDiagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION' as const,
        retainedApplicationCount: projected.inventory.applicationCount };
      if (!projected.document) {
        return { ...deferred(alias, orderedCodes([...preflightCodes,
          ...untouched.diagnostics.map(({ code }) => code),
          ...projected.diagnostics.map(({ code }) => code)]), projected.inventory),
        untouchedLedger, projectionLedger };
      }
      return complete(alias, 'projected', projected.document, projected.inventory,
        preflightCodes, input.candidateObservations, { untouchedLedger, projectionLedger });
    }
  }

  const imported = importMotionHtml(source, materialization?.ok ? {
    ...materialization.provenance,
    ...(inertWarning ? { materializedSourceDigest: digest(source) } : {}),
  } : undefined);
  const codes = orderedCodes([...preflightCodes, ...imported.diagnostics.map(({ code }) => code),
    ...(inertWarning ? ['IMPORT_TRANSITION_INERT'] : [])]);
  if (preflightCodes.length > 0 || !imported.document) {
    return deferred(alias, codes, imported.inventory);
  }
  return complete(alias, 'imported', imported.document, imported.inventory, codes,
    input.candidateObservations);
}

function complete(alias: FiveSceneAlias, outcome: 'imported' | 'projected', document: MotionDocument,
  inventory: ImportInventory, diagnosticCodes: readonly string[],
  observations: readonly FiveSceneCandidateObservation[] | undefined,
  ledgers: Pick<FiveSceneResult, 'untouchedLedger' | 'projectionLedger'> = {}): FiveSceneResult {
  const candidates = makeCandidates(document, observations ?? []);
  return { alias, outcome, document, inventory, diagnosticCodes, candidateStatus: 'available',
    candidateCount: candidates.length, candidates, ...ledgers };
}

function deferred(alias: FiveSceneAlias, diagnosticCodes: readonly string[],
  inventory: ImportInventory | null = null): FiveSceneResult {
  return { alias, outcome: 'deferred', document: null, inventory,
    diagnosticCodes: orderedCodes(diagnosticCodes), candidateStatus: 'unavailable',
    candidateCount: 0, candidates: [] };
}

function makeCandidates(document: MotionDocument,
  observations: readonly FiveSceneCandidateObservation[]): FiveSceneCandidate[] {
  return observations.map((observation) => {
    if (!categories.has(observation.category) || observation.targetIds.length === 0
      || observation.targetIds.some((id) => !/^el_[a-zA-Z0-9_-]+$/.test(id))
      || !Number.isSafeInteger(observation.startMs) || !Number.isSafeInteger(observation.endMs)
      || observation.startMs < 0 || observation.endMs < observation.startMs
      || observation.evidenceKinds.length === 0
      || observation.evidenceKinds.some((kind) => !evidenceKinds.has(kind))) {
      throw new Error('IMPORT_CANDIDATE_OBSERVATION_INVALID');
    }
    const counts = Object.fromEntries([...new Set(observation.evidenceKinds)].sort().map((kind) =>
      [kind, observation.evidenceKinds.filter((candidate) => candidate === kind).length]));
    const kinds = new Set(observation.evidenceKinds);
    const confidence = kinds.size >= 3 && kinds.has('target-proximity') && kinds.has('coincident-boundary')
      ? 'high' : kinds.size >= 2 && [...kinds].some((kind) => kind.includes('boundary')
        || kind === 'stable-interval' || kind === 'multi-element-synchrony') ? 'medium' : 'low';
    const core = { sourceDigest: document.inventory.sourceDigest, category: observation.category,
      targetIds: [...observation.targetIds], startMs: observation.startMs, endMs: observation.endMs,
      confidence, evidenceKindCounts: counts, evidenceCount: observation.evidenceKinds.length } as const;
    return { id: `candidate_${digest(JSON.stringify(core)).slice(0, 16)}`, ...core };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function certifySceneC(source: string, certificate: SceneCInertCertificate | undefined): string | null {
  const closure = inspectSceneCStaticClosure(source, certificate?.declarationOrdinal ?? -1);
  if (!certificate || certificate.schemaVersion !== 'motion.scene-c-inert-certificate.v1'
    || certificate.sourceDigest !== digest(source) || !certificate.staticScriptFree
    || !certificate.targetPropertySetClosed || !certificate.cascadeResolved
    || certificate.reachableStateProbeCount < 3 || !certificate.zeroTransitionAnimations
    || !certificate.exactRenderedEquality || certificate.unexpectedNetworkRequestCount !== 0
    || !closure) return null;
  const projected = removeMotionApplication(source, certificate.declarationOrdinal, 'transition');
  return projected && digest(projected) === certificate.declarationRemovedSourceDigest ? projected : null;
}

export async function collectSceneCInertnessCertificate(source: string,
  declarationOrdinal = 0): Promise<SceneCInertCertificate | null> {
  if (!inspectSceneCStaticClosure(source, declarationOrdinal)) return null;
  const declarationRemovedSource = removeMotionApplication(source, declarationOrdinal, 'transition');
  if (!declarationRemovedSource) return null;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let unexpectedNetworkRequestCount = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
      reducedMotion: 'no-preference' });
    const render = async (html: string) => {
      const page = await context.newPage();
      page.on('request', (request) => {
        if (/^https?:/i.test(request.url())) unexpectedNetworkRequestCount += 1;
      });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(async () => { await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const probeCounts: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        probeCounts.push(await page.evaluate(() => document.getAnimations()
          .filter((animation) => animation.constructor.name === 'CSSTransition').length));
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      }
      const screenshot = await page.screenshot({ animations: 'disabled' });
      await page.close();
      return { probeCounts, screenshot };
    };
    const original = await render(source);
    const projected = await render(declarationRemovedSource);
    return {
      schemaVersion: 'motion.scene-c-inert-certificate.v1',
      sourceDigest: digest(source), declarationOrdinal,
      declarationRemovedSourceDigest: digest(declarationRemovedSource),
      staticScriptFree: true, targetPropertySetClosed: true, cascadeResolved: true,
      reachableStateProbeCount: original.probeCounts.length,
      zeroTransitionAnimations: [...original.probeCounts, ...projected.probeCounts]
        .every((count) => count === 0),
      exactRenderedEquality: original.screenshot.equals(projected.screenshot),
      unexpectedNetworkRequestCount,
    };
  } finally {
    await browser.close();
  }
}

function inspectSceneCStaticClosure(source: string, declarationOrdinal: number): boolean {
  if (!Number.isSafeInteger(declarationOrdinal) || declarationOrdinal < 0
    || /<script\b|\son[a-z]+\s*=|\bcontenteditable\b|<(?:input|select|textarea|details|dialog)\b/i.test(source)
    || /:(?:hover|active|focus|focus-within|focus-visible|checked|target|has)\b/i.test(source)) return false;
  const block = singleStyleBlock(source);
  if (!block) return false;
  const root = postcss.parse(block.css);
  const transitions: Declaration[] = [];
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    if (property === 'transition' || property.startsWith('transition-')) transitions.push(declaration);
  });
  if (transitions.length !== 1 || declarationOrdinal !== 0) return false;
  const transition = transitions[0]!;
  if (transition.prop.toLowerCase() !== 'transition' || transition.parent?.type !== 'rule'
    || transition.parent.selector.includes(',') || /::|:(?!where\(|is\()/i.test(transition.parent.selector)
    || /\b(?:all|var|env|inherit|initial|unset|revert)\b|,/i.test(transition.value)) return false;
  const transitionedProperty = transition.value.trim().split(/\s+/)[0]?.toLowerCase();
  if (!transitionedProperty || !/^[a-z][a-z0-9-]*$/.test(transitionedProperty)) return false;
  let keyframeWritesProperty = false;
  root.walkAtRules((atRule) => {
    if (!atRule.name.toLowerCase().endsWith('keyframes')) return;
    atRule.walkDecls((declaration) => {
      if (declaration.prop.toLowerCase() === transitionedProperty) keyframeWritesProperty = true;
    });
  });
  return !keyframeWritesProperty;
}

function projectSceneE(source: string, originalSource: string, projection: SceneEProjection | undefined,
  pseudoCount: number): { source: string } | null {
  if (!projection || projection.originalSourceDigest !== digest(originalSource)
    || projection.expectedPseudoApplicationCount !== pseudoCount
    || projection.applicationOrdinals.length !== pseudoCount
    || new Set(projection.applicationOrdinals).size !== pseudoCount) return null;
  let projected = source;
  for (const ordinal of [...projection.applicationOrdinals].sort((a, b) => b - a)) {
    const next = removeMotionApplication(projected, ordinal, 'pseudo');
    if (!next) return null;
    projected = next;
  }
  return countPseudoApplications(projected) === 0 ? { source: projected } : null;
}

function removeMotionApplication(source: string, ordinal: number, kind: 'transition' | 'pseudo'): string | null {
  const block = singleStyleBlock(source);
  if (!block) return null;
  const root = postcss.parse(block.css);
  const declarations: Declaration[] = [];
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    rule.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase();
      if ((kind === 'transition' && (property === 'transition' || property.startsWith('transition-')))
        || (kind === 'pseudo' && (property === 'animation' || property === 'animation-name'))) {
        declarations.push(declaration);
      }
    });
  });
  const target = declarations[ordinal];
  if (!target || (kind === 'pseudo'
    && (target.parent?.type !== 'rule' || !target.parent.selector.includes('::')))) return null;
  const start = target.source?.start?.offset;
  const end = target.source?.end?.offset;
  if (start === undefined || end === undefined) return null;
  const sourceSlice = block.css.slice(start, end + 1);
  const trailingWhitespace = sourceSlice.match(/\s*$/)?.[0].length ?? 0;
  const endExclusive = end + 1 - trailingWhitespace;
  const projectedCss = `${block.css.slice(0, start)}${block.css.slice(endExclusive)}`;
  return `${source.slice(0, block.start)}${projectedCss}${source.slice(block.end)}`;
}

function countPseudoApplications(source: string): number {
  const block = singleStyleBlock(source);
  if (!block) return 0;
  let count = 0;
  postcss.parse(block.css).walkRules((rule) => {
    if (!isInsideKeyframes(rule) && rule.selector.includes('::')
      && rule.nodes.some((node) => node.type === 'decl'
        && (node.prop.toLowerCase() === 'animation'
          || node.prop.toLowerCase() === 'animation-name'))) count += 1;
  });
  return count;
}

function retainsNonPseudoInventory(untouched: ImportInventory, projected: ImportInventory): boolean {
  return projected.ruleCount === untouched.ruleCount
    && projected.applicationCount === untouched.applicationCount
    && projected.slotCount === untouched.slotCount
    && projected.trackCount === untouched.trackCount
    && projected.supportedCount === untouched.supportedCount
    && projected.missingCount === untouched.missingCount;
}

function containsTransition(source: string): boolean {
  const block = singleStyleBlock(source);
  if (!block) return /\btransition(?:-[a-z-]+)?\s*:/i.test(source);
  let found = false;
  postcss.parse(block.css).walkDecls((declaration) => {
    if (declaration.prop.toLowerCase() === 'transition'
      || declaration.prop.toLowerCase().startsWith('transition-')) found = true;
  });
  return found;
}

function singleStyleBlock(source: string): { start: number; end: number; css: string } | null {
  const matches = [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  const css = match[1]!;
  const start = match.index! + match[0].indexOf(css);
  return { start, end: start + css.length, css };
}

function isInsideKeyframes(rule: Rule): boolean {
  let current = rule.parent as { type: string; name?: string; parent?: unknown } | undefined;
  while (current) {
    if (current.type === 'atrule' && current.name?.toLowerCase().endsWith('keyframes')) return true;
    current = current.parent as typeof current;
  }
  return false;
}

function orderedCodes(codes: readonly string[]): string[] {
  return [...new Set(codes)].sort();
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function inspectFiveSceneClosure(input: Readonly<{ scenes: readonly Readonly<{
  alias: FiveSceneAlias; outcome: FiveSceneResult['outcome']; candidateStatus: FiveSceneResult['candidateStatus'];
  candidateCount: number; diagnosticCodes: readonly string[];
}>[] }>) {
  return input.scenes.map((scene) => ({ alias: scene.alias, outcome: scene.outcome,
    candidateStatus: scene.candidateStatus, candidateCount: scene.candidateCount,
    diagnosticCodes: [...scene.diagnosticCodes] }));
}
