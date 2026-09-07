import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrajectorySeed } from './seed.ts';
import { SqliteProjectStore, type FaultPoint } from './sqlite-project-store.ts';
import type { SequenceCommand } from '../../motion-protocol/src/sequence.ts';
export const human = { actor: 'human' as const, capability: 'human-editor', now: 1000 };
export const agent = { actor: 'agent' as const, capability: 'cli-agent', claimSecret: randomBytes(32).toString('hex'), now: 1000 };
export async function sequenceTestStore(fault?: (point: FaultPoint) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'motion-sequence-store-')); const path = join(directory, 'project.sqlite');
  const seed = createTrajectorySeed(); const store = new SqliteProjectStore(path, fault); store.initialize(seed);
  const base = { protocolVersion: 'motion.sequence-protocol.v1' as const, projectId: store.readProjectCatalog().projectId,
    sequenceId: 'sequence_one', expectedRevision: 0, operationId: 'create' };
  const source = { documentId: seed.documentId, revision: 0, canonicalDigest: store.readHead(seed.documentId)!.canonicalDigest, durationMs: seed.durationMs };
  const create: SequenceCommand = { ...base, kind: 'sequence.create', name: 'Animation', viewport: { widthCssPixels: 800, heightCssPixels: 450 },
    initialClip: { clipId: 'clip_one', name: 'Opening', source, endHoldMs: 0 }, claim: false };
  return { store, seed, base, create, source, path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
