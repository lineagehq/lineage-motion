import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { createPhase3Seed } from './seed.ts';

export async function temporaryStore(): Promise<{ directory: string; databasePath: string; cleanup(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'lineage-motion-phase3-'));
  return { directory, databasePath: join(directory, 'project.sqlite'), cleanup: () => rm(directory, { recursive: true, force: true }) };
}
export function phase3Seed() { return createPhase3Seed(); }
export function phase3Command(operationId = 'operation-public-001', elementId: 'el_a2849ff826f3e167' | 'el_2dbee68b1ea318c8' = 'el_2dbee68b1ea318c8') {
  const seed = phase3Seed(); return makeTrackCreateCommand({ operationId, documentId: seed.documentId,
    expectedRevision: seed.revision, elementId });
}
