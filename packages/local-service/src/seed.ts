import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { importMotionHtml } from '../../css-import/src/index.ts';
import { validateMotionDocument, type MotionDocument } from '../../domain/src/index.ts';

export function createPhase3Seed(repositoryRoot = resolve(import.meta.dirname, '../../..')): MotionDocument {
  const source = readFileSync(resolve(repositoryRoot, 'fixtures/public-synthetic/preview.html'), 'utf8');
  const imported = importMotionHtml(source);
  if (!imported.document) throw new Error(imported.diagnostics[0]?.code ?? 'PHASE3_SEED_IMPORT_FAILED');
  return {
    ...imported.document,
    cues: [
      { schemaVersion: 'motion.cue.v1', id: 'cue_origin', label: 'Origin', timeMs: 0 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_copy', label: 'Copy arrives', timeMs: 860 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_cursor', label: 'Cursor advances', timeMs: 1730 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_pair', label: 'Pair crosses', timeMs: 2870 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_hold', label: 'Hold inspected', timeMs: 4310 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_rest', label: 'Rest', timeMs: 4660 },
    ],
    reducedMotion: { mode: 'source-snapshot', css: '@media (prefers-reduced-motion: reduce) { .stage * { animation: none; } }' },
  };
}

export function createTrajectorySeed(repositoryRoot = resolve(import.meta.dirname, '../../..')): MotionDocument {
  const source = readFileSync(resolve(repositoryRoot, 'fixtures/public-synthetic/landing-shot1.html'), 'utf8');
  const imported = importMotionHtml(source);
  if (!imported.document) throw new Error(imported.diagnostics[0]?.code ?? 'TRAJECTORY_SEED_IMPORT_FAILED');
  return { ...imported.document, cues: [
    { schemaVersion: 'motion.cue.v1', id: 'trajectory_start', label: 'Start', timeMs: 0 },
    { schemaVersion: 'motion.cue.v1', id: 'trajectory_landed', label: 'Landed', timeMs: 700 },
    { schemaVersion: 'motion.cue.v1', id: 'trajectory_settled', label: 'Settled', timeMs: 2100 },
    { schemaVersion: 'motion.cue.v1', id: 'trajectory_later', label: 'Later continuity', timeMs: 2800 },
  ] };
}

export function createLandingShot1EditorSeed(
  repositoryRoot = resolve(import.meta.dirname, '../../..'),
  privateDocumentPath?: string,
): MotionDocument {
  if (!privateDocumentPath) return createTrajectorySeed(repositoryRoot);
  const document = JSON.parse(readFileSync(resolve(privateDocumentPath), 'utf8')) as MotionDocument;
  if (!validateMotionDocument(document).ok) throw new Error('LANDING_SHOT1_EDITOR_SEED_INVALID');
  return document;
}

export function createPhase4SceneDSeed(
  repositoryRoot = resolve(import.meta.dirname, '../../..'),
  privateDocumentPath?: string,
): MotionDocument {
  if (!privateDocumentPath) {
    const source = readFileSync(resolve(repositoryRoot, 'fixtures/public-synthetic/cursor-click-reveal.html'), 'utf8');
    const imported = importMotionHtml(source);
    if (!imported.document) throw new Error(imported.diagnostics[0]?.code ?? 'PHASE4_CURSOR_CLICK_REVEAL_SEED_IMPORT_FAILED');
    return imported.document;
  }
  const document = JSON.parse(readFileSync(privateDocumentPath, 'utf8')) as MotionDocument;
  if (!validateMotionDocument(document).ok || document.inventory.ruleCount !== 9
    || document.inventory.applicationCount !== 8 || document.inventory.slotCount !== 9
    || document.inventory.trackCount !== 20) throw new Error('PHASE4_SCENE_D_SEED_INVALID');
  return document;
}

export function createPhase4ReusableCueSeed(repositoryRoot = resolve(import.meta.dirname, '../../..')): MotionDocument {
  const source = readFileSync(resolve(repositoryRoot, 'fixtures/public-synthetic/reusable-cues.html'), 'utf8');
  const imported = importMotionHtml(source);
  if (!imported.document) throw new Error(imported.diagnostics[0]?.code ?? 'PHASE4_REUSABLE_CUE_SEED_IMPORT_FAILED');
  imported.document.elements.push(
    { id: 'el_1000000000000001', selectorHint: '.type', structuralFingerprint: 'html[0]/body[0]/main[0]/p[0]',
      editableText: 'Synthetic typing sample' },
    { id: 'el_1000000000000002', selectorHint: '.cursor', structuralFingerprint: 'html[0]/body[0]/main[0]/i[0]' },
    { id: 'el_1000000000000003', selectorHint: '.selected', structuralFingerprint: 'html[0]/body[0]/main[0]/button[0]' },
    { id: 'el_1000000000000004', selectorHint: '.highlight', structuralFingerprint: 'html[0]/body[0]/main[0]/div[1]' },
    { id: 'el_1000000000000005', selectorHint: '.dragged', structuralFingerprint: 'html[0]/body[0]/main[0]/div[2]' },
  );
  return { ...imported.document, durationMs: 3000,
    reducedMotion: { mode: 'source-snapshot',
      css: '@media (prefers-reduced-motion: reduce) { .stage * { animation: none; } }' } };
}
