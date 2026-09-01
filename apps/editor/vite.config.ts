import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { compileMotionDocument } from '../../packages/css-compiler/src/index.js';
import { createLandingShot1EditorSeed, createPhase3Seed, createPhase4SceneDSeed } from '../../packages/local-service/src/seed.ts';

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
      const repositoryRoot = resolve(import.meta.dirname, '../..');
      const landingShot1Workspace = process.env.LANDING_SHOT1_WORKSPACE === '1';
      const phase4CueWorkspace = process.env.PHASE4_CURSOR_CLICK_REVEAL === '1';
      const motionDocument = phase4CueWorkspace ? createPhase4SceneDSeed(repositoryRoot, process.env.PHASE4_SCENE_D_DOCUMENT_PATH)
        : landingShot1Workspace
        ? createLandingShot1EditorSeed(repositoryRoot, process.env.LANDING_SHOT1_DOCUMENT_PATH)
        : createPhase3Seed(repositoryRoot);
      return `export default ${JSON.stringify({
        document: motionDocument,
        compiled: compileMotionDocument(motionDocument),
        serviceBacked: Boolean(process.env.PHASE3_SERVICE_URL),
        humanCapability: process.env.PHASE3_HUMAN_CAPABILITY ?? null,
        ...(landingShot1Workspace ? { shotWorkspace: {
          schemaVersion: 'motion.editor-shot-workspace.v1',
          documentId: motionDocument.documentId,
          startMs: 0,
          landedMs: 700,
          settledMs: 2100,
          targetElementIds: motionDocument.elements.map((element) => element.id).sort(),
        } } : {}), ...(phase4CueWorkspace ? { cueWorkspace: { schemaVersion: 'motion.editor-cue-workspace.v1' } } : {}),
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
