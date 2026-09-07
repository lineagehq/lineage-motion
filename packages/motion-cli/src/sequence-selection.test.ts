import { expect, test } from 'vitest';
import { SequenceServiceClient } from '../../motion-protocol/src/sequence-client.ts';
import { sequenceFixture } from './sequence-test-support.ts';
import { invoke } from './managed-test-support.ts';

test('sequence selection, claim isolation, exact units, stale revisions and human updates remain explicit', async () => {
  const f = await sequenceFixture();
  try {
    expect((await f.create()).code).toBe(0);
    expect((await f.mutate('sequence-clip-hold', 0, 'too-precise', ['--clip-id', 'none', '--end-hold-seconds', '0.0001'])).json.diagnostic.code).toBe('CLI_UNIT_PRECISION');
    expect((await f.mutate('sequence-rename', 0, 'ignored', ['--name', 'X', '--track-id', 'ignored'])).json.diagnostic.code).toBe('CLI_OPTIONS_INVALID');
    expect((await invoke(['sequence-rename', ...f.common, '--sequence-id', 'story', '--name', 'X', '--operation-id', 'no-claim', '--expected-revision', '0'])).json.diagnostic.code).toBe('CLI_SEQUENCE_CLAIM_REQUIRED');
    expect((await invoke(['claim-acquire', ...f.common, '--document-id', 'shot_two', '--claim', 'shot-only', '--scope', 'document', '--operation-id', 'shot-claim', '--expected-revision', '0'])).code).toBe(0);
    expect((await f.mutate('sequence-rename', 0, 'wrong-context', ['--name', 'X'], 'shot-only')).json.diagnostic.code).toBe('CLI_SEQUENCE_CLAIM_NOT_FOUND');
    const race = await Promise.all(['Left', 'Right'].map(name => f.mutate('sequence-rename', 0, `race-${name}`, ['--name', name])));
    expect(race.filter(r => r.json.ok)).toHaveLength(1); expect(race.find(r => !r.json.ok)?.json.code).toBe('SEQUENCE_STALE_REVISION');
    expect((await f.mutate('sequence-claim-renew', 1, 'renew', ['--lease-version', '1'])).json).toMatchObject({ ok: true, claim: { leaseVersion: 2 } });
    expect((await f.mutate('sequence-claim-renew', 1, 'stale-lease', ['--lease-version', '1'])).json.code).toBe('SEQUENCE_STALE_LEASE');
    expect((await f.mutate('sequence-claim-release', 1, 'release', ['--lease-version', '2'])).json).toMatchObject({ ok: true, claim: { leaseVersion: 3 } });
    const human = new SequenceServiceClient(f.service.url, f.auth);
    expect(await human.execute({ protocolVersion: 'motion.sequence-protocol.v1', kind: 'sequence.edit', projectId: 'sequence_project', sequenceId: 'story', operationId: 'human-rename', expectedRevision: 1, edit: { kind: 'sequence.rename', name: 'Human update' } })).toMatchObject({ ok: true, revision: 2 });
    expect((await f.read()).json.sequence.name).toBe('Human update');
    expect((await f.mutate('sequence-claim-acquire', 2, 'claim-new', [], 'next')).code).toBe(0);
    expect((await f.mutate('sequence-claim-acquire', 2, 'claim-other', [], 'other')).json.code).toBe('SEQUENCE_CLAIM_CONFLICT');
    expect(await human.execute({ protocolVersion: 'motion.sequence-protocol.v1', kind: 'sequence.create', projectId: 'sequence_project', sequenceId: 'other', operationId: 'other-create', expectedRevision: 0, name: 'Other', viewport: { widthCssPixels: 320, heightCssPixels: 180 }, initialClip: null, claim: false })).toMatchObject({ ok: true });
    expect((await f.read()).json.diagnostic.code).toBe('CLI_SEQUENCE_AMBIGUOUS');
    expect((await f.read('sequence', ['--sequence-id', 'story'])).json.sequence.name).toBe('Human update');
    expect((await f.read('sequences', ['--project-id', 'wrong'])).json.diagnostic.code).toBe('CLI_PROJECT_MISMATCH');
  } finally { await f.cleanup(); }
}, 25_000);
