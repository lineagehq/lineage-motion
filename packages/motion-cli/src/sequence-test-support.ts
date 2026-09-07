import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { SequenceServiceClient } from '../../motion-protocol/src/sequence-client.ts';
import { fixture, invoke } from './managed-test-support.ts';
export const shotHtml = (seconds: number) => `<style>html,body{width:320px;height:180px;margin:0;overflow:hidden}
.tile{width:30px;height:30px;background:red;animation:move ${seconds}s linear both}
@keyframes move{from{transform:translateX(0px)}to{transform:translateX(120px)}}</style><div class="tile" aria-label="Moving tile"></div>`;
export async function sequenceFixture() {
  const f = await fixture(); const human = randomBytes(32).toString('base64url');
  const seed = importMotionHtml(shotHtml(2)).document!; seed.documentId = 'shot_two';
  const settings = { databasePath: join(f.directory, 'project.sqlite'), seed,
    project: { projectId: 'sequence_project', name: f.project }, capabilities: { human, agent: f.capability }, now: () => 1000 };
  const service = await startLocalMotionService(settings);
  const auth = { actor: 'human' as const, capability: human, now: 1000 };
  expect(service.store.admitShot({ protocolVersion: 'motion.project-protocol.v1', kind: 'motion.shot.admit',
    operationId: 'admit-three', projectId: settings.project.projectId, expectedCatalogRevision: 0, documentId: 'shot_three',
    name: 'Three seconds', source: { kind: 'html-css', html: shotHtml(3) }, claim: null }, auth)).toMatchObject({ ok: true });
  const sessionPath = await f.writeSession(service.url);
  const session = JSON.parse(await readFile(sessionPath, 'utf8'));
  await writeFile(sessionPath, JSON.stringify({ ...session, projectId: settings.project.projectId }));
  const common = ['--data-dir', f.dataDir];
  const read = (name = 'sequence', args: string[] = []) => invoke([name, ...common, ...args]);
  const mutate = (name: string, revision: number, operationId: string, args: string[] = [], handle = 'story') =>
    invoke([name, ...common, '--sequence-id', 'story', '--claim', handle, '--operation-id', operationId, '--expected-revision', String(revision), ...args]);
  const create = () => mutate('sequence-create', 0, 'create-story', ['--name', 'Story', '--viewport-width', '320', '--viewport-height', '180']);
  const client = new SequenceServiceClient(service.url, auth);
  return { ...f, service, settings, auth, sessionPath, common, read, mutate, create, client,
    cleanup: async () => { await service.close(); await f.cleanup(); } };
}
