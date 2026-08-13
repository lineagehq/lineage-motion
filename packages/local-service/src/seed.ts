import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { importMotionHtml } from '../../css-import/src/index.ts';
import type { MotionDocument } from '../../domain/src/index.ts';

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
    reducedMotion: { mode: 'source-snapshot', css: '@media (prefers-reduced-motion: reduce) { .stage { scroll-behavior: auto; } }' },
  };
}
