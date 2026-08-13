import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { compileMotionDocument } from '../../packages/css-compiler/src/index.js';
import { createPhase3Seed } from '../../packages/local-service/src/seed.ts';

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
      const motionDocument = createPhase3Seed(resolve(import.meta.dirname, '../..'));
      return `export default ${JSON.stringify({
        document: motionDocument,
        compiled: compileMotionDocument(motionDocument),
        serviceBacked: Boolean(process.env.PHASE3_SERVICE_URL),
        humanCapability: process.env.PHASE3_HUMAN_CAPABILITY ?? null,
      })}`;
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [compiledMotionPlugin()],
  ...(process.env.PHASE3_SERVICE_URL ? { server: { proxy: {
    '/api': process.env.PHASE3_SERVICE_URL,
    '/health': process.env.PHASE3_SERVICE_URL,
  } } } : {}),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
