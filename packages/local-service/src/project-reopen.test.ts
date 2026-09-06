import { afterEach, expect, test } from 'vitest';
import { startLocalMotionService, type LocalMotionService } from './index.ts';
import { phase3Command, phase3Seed, temporaryStore } from './test-support.ts';
import { MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import { PROJECT_PROTOCOL_VERSION } from '../../motion-protocol/src/project.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; });
test('managed opening preserves existing catalog identity, saved revisions and admission receipts exactly', async () => {
  const temporary = await temporaryStore(); cleanup.push(temporary.cleanup);
  let service: LocalMotionService | undefined;
  cleanup.push(async () => { await service?.close(); });
  service = await startLocalMotionService({ databasePath: temporary.databasePath, seed: phase3Seed() });
  expect(await new MotionServiceClient(service.url).dispatch(phase3Command('saved-before-upgrade'))).toMatchObject({ ok: true });
  const catalog = service.store.readProjectCatalog();
  const command = { protocolVersion: PROJECT_PROTOCOL_VERSION, kind: 'motion.shot.admit' as const,
    operationId: 'admitted-before-upgrade', projectId: catalog.projectId, expectedCatalogRevision: catalog.catalogRevision,
    documentId: 'saved-shot', name: 'Saved shot', source: { kind: 'starter' as const, starterId: 'trajectory' as const }, claim: null };
  const auth = { actor: 'human' as const, capability: 'human-editor' };
  const admission = await new ProjectServiceClient(service.url, auth).admit(command);
  expect(admission.ok).toBe(true);
  const before = service.store.snapshot(); const savedCatalog = service.store.readProjectCatalog();
  await service.close(); service = undefined;
  const options = { databasePath: temporary.databasePath, seed: phase3Seed(),
    project: { projectId: 'derived-checkout-name-identity', name: 'Configured project name' } };
  // Explicit identity callers still fail closed; normal managed open preserves the stored identity.
  await expect(startLocalMotionService(options)).rejects.toThrow('STORE_PROJECT_MISMATCH');
  service = await startLocalMotionService({ ...options, preserveExistingProjectIdentity: true });
  expect(service.store.snapshot()).toEqual(before);
  expect(service.store.readProjectCatalog()).toEqual(savedCatalog);
  expect(await new ProjectServiceClient(service.url, auth).admit(command)).toEqual(admission);
  expect(service.store.snapshot()).toEqual(before);
});

test('managed creation still assigns the requested identity to a new project', async () => {
  const temporary = await temporaryStore(); cleanup.push(temporary.cleanup);
  const project = { projectId: 'new-project-identity', name: 'New named project' };
  const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed: phase3Seed(),
    project, preserveExistingProjectIdentity: true });
  cleanup.push(() => service.close());
  expect(service.store.readProjectCatalog()).toMatchObject(project);
});
