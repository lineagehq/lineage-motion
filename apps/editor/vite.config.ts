import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { compileMotionDocument } from '../../packages/css-compiler/src/index.js';
import { importMotionHtml } from '../../packages/css-import/src/index.js';

const virtualId = 'virtual:motion-document';
const resolvedVirtualId = `\0${virtualId}`;

function compiledMotionPlugin() {
  return {
    name: 'compiled-motion-document',
    resolveId(id: string) {
      return id === virtualId ? resolvedVirtualId : null;
    },
    load(id: string) {
      if (id !== resolvedVirtualId) return null;
      const source = readFileSync(
        resolve(import.meta.dirname, '../../fixtures/public-synthetic/preview.html'),
        'utf8',
      );
      const imported = importMotionHtml(source);
      if (!imported.document) throw new Error(imported.diagnostics[0]?.code ?? 'EDITOR_IMPORT_FAILED');
      const motionDocument = {
        ...imported.document,
        cues: [
          { schemaVersion: 'motion.cue.v1' as const, id: 'cue_origin', label: 'Origin', timeMs: 0 },
          { schemaVersion: 'motion.cue.v1' as const, id: 'cue_copy', label: 'Copy arrives', timeMs: 860 },
          { schemaVersion: 'motion.cue.v1' as const, id: 'cue_cursor', label: 'Cursor advances', timeMs: 1730 },
          { schemaVersion: 'motion.cue.v1' as const, id: 'cue_pair', label: 'Pair crosses', timeMs: 2870 },
          { schemaVersion: 'motion.cue.v1' as const, id: 'cue_hold', label: 'Hold inspected', timeMs: 4310 },
          { schemaVersion: 'motion.cue.v1' as const, id: 'cue_rest', label: 'Rest', timeMs: 4660 },
        ],
        reducedMotion: {
          mode: 'source-snapshot' as const,
          css: '@media (prefers-reduced-motion: reduce) { .stage { scroll-behavior: auto; } }',
        },
      };
      return `export default ${JSON.stringify({
        document: motionDocument,
        compiled: compileMotionDocument(motionDocument),
      })}`;
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [compiledMotionPlugin()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
