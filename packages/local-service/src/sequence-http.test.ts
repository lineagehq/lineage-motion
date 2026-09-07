import { expect, test } from 'vitest';
import { request } from 'node:http';
import { sequenceTestStore } from './sequence-test-support.ts';
import { startLocalMotionService } from './index.ts';
import { canonicalJson } from '../../domain/src/index.ts';

test('sequence commands preserve UTF-8 across HTTP chunks and reject malformed encoding atomically', async () => {
  const t = await sequenceTestStore(); t.store.close();
  const service = await startLocalMotionService({ databasePath: t.path, seed: t.seed });
  try {
    const command = { ...t.create, name: 'Café — animation' };
    const bytes = Buffer.from(canonicalJson(command)); const split = bytes.indexOf(Buffer.from('é')) + 1;
    const post = (body: Buffer) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = request(`${service.url}/api/sequence/v1/commands`, { method: 'POST', headers: {
        authorization: 'Bearer human-editor', 'x-motion-actor': 'human', 'content-type': 'application/json', 'content-length': body.length,
      } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString('utf8') }));
      });
      outgoing.on('error', reject); outgoing.write(body.subarray(0, split));
      setTimeout(() => outgoing.end(body.subarray(split)), 50);
    });
    const accepted = await post(bytes); expect(accepted.status).toBe(200);
    expect(service.store.readSequence(t.base.sequenceId, 1000)!.sequence.name).toBe(command.name);
    const before = service.store.snapshot(); const invalid = Buffer.from(bytes); invalid[split] = 0xff;
    expect((await post(invalid)).status).toBe(422); expect(service.store.snapshot()).toEqual(before);
  } finally { await service.close(); await t.cleanup(); }
});
