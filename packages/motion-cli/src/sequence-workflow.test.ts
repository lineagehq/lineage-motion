import { expect, test } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { SequenceServiceClient } from '../../motion-protocol/src/sequence-client.ts';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { sha256Hex } from '../../domain/src/sha256.ts';
import { sequenceFixture } from './sequence-test-support.ts';
import { invoke } from './managed-test-support.ts';
import { sequenceOptions } from './sequence-discovery.ts';

test('ordinary managed CLI discovers and edits two pinned shots through every storyboard operation', async () => {
  const f = await sequenceFixture();
  try {
    const help = (await invoke(['help'])).json;
    expect(help.sequences).toEqual(Object.keys(sequenceOptions));
    for (const name of Object.keys(sequenceOptions)) expect((await invoke([name, '--help'])).json.name).toBe(name);
    const sources = (await f.read('sequence-sources')).json;
    expect(sources.shots.map((shot: any) => shot.source.durationMs).sort()).toEqual([2000, 3000]);
    expect(sources.shots.every((shot: any) => shot.reasonCode === null)).toBe(true);
    expect((await f.create()).json).toMatchObject({ ok: true, revision: 0, claim: { leaseVersion: 1 } });
    const pin = (id: string) => ['--source-document-id', id, '--source-revision', '0'];
    expect((await f.mutate('sequence-clip-add', 0, 'add-two', ['--clip-id', 'two', '--name', 'Opening', '--index', '0', ...pin('shot_two')])).json).toMatchObject({ ok: true, revision: 1 });
    expect((await f.mutate('sequence-clip-add', 1, 'add-three', ['--clip-id', 'three', '--name', 'Ending', '--index', '1', ...pin('shot_three')])).json).toMatchObject({ ok: true, revision: 2 });
    expect((await f.read('sequences')).json.sequences[0]).toMatchObject({ durationMs: 5000, clipCount: 2 });
    expect((await f.mutate('sequence-clip-move', 2, 'reorder', ['--clip-id', 'three', '--index', '0'])).json).toMatchObject({ ok: true, revision: 3 });
    expect((await f.mutate('sequence-clip-hold', 3, 'hold', ['--clip-id', 'three', '--end-hold-seconds', '0.125'])).json).toMatchObject({ ok: true, revision: 4 });
    expect((await f.mutate('sequence-clip-duplicate', 4, 'duplicate', ['--clip-id', 'three', '--new-clip-id', 'duplicate', '--name', 'Copy'])).json).toMatchObject({ ok: true, revision: 5 });
    expect((await f.mutate('sequence-clip-hold', 5, 'copy-hold', ['--clip-id', 'duplicate', '--end-hold-ms', '999'])).code).toBe(0);
    const copied = (await f.read()).json.sequence;
    expect(copied.clips.find((c: any) => c.clipId === 'three').endHoldMs).toBe(125);
    expect(copied.clips.find((c: any) => c.clipId === 'duplicate').endHoldMs).toBe(999);
    expect((await f.mutate('sequence-clip-remove', 6, 'remove-copy', ['--clip-id', 'duplicate'])).code).toBe(0);
    expect((await f.mutate('sequence-clip-rename', 7, 'rename-clip', ['--clip-id', 'two', '--name', 'Second'])).code).toBe(0);
    expect((await f.mutate('sequence-rename', 8, 'rename-sequence', ['--name', 'Delivered animation'])).code).toBe(0);
    const document = f.service.store.readHead('shot_three')!.document;
    expect(await new MotionServiceClient(f.service.url, fetch, f.auth).dispatch(makeTrackCreateCommand({ operationId: 'human-source', documentId: document.documentId, expectedRevision: 0, elementId: document.elements.find(element => element.selectorHint === '.tile')!.id }))).toMatchObject({ ok: true });
    expect((await f.read()).json.sequence.clips[0].source.revision).toBe(0);
    expect((await f.read('sequence-sources')).json.shots.find((s: any) => s.source.documentId === 'shot_three').source.revision).toBe(1);
    expect((await f.mutate('sequence-clip-update-source', 9, 'stale-source', ['--clip-id', 'three', '--source-document-id', 'shot_three', '--source-revision', '0'])).json.diagnostic.code).toBe('CLI_SEQUENCE_SOURCE_STALE');
    expect((await f.mutate('sequence-clip-update-source', 9, 'update-source', ['--clip-id', 'three', '--source-document-id', 'shot_three', '--source-revision', '1'])).code).toBe(0);
    expect((await f.mutate('sequence-undo', 10, 'undo-source')).code).toBe(0);
    expect((await f.read()).json.sequence.clips[0].source.revision).toBe(0);
    expect((await f.mutate('sequence-redo', 11, 'redo-source')).code).toBe(0);
    const final = (await f.read()).json;
    expect(final.sequence).toMatchObject({ revision: 12, name: 'Delivered animation', clips: [{ clipId: 'three', endHoldMs: 125, source: { revision: 1 } }, { clipId: 'two' }] });
    expect(final).toEqual(await f.client.snapshot('story'));
    const bytes: Buffer[] = [];
    for (let i = 0; i < 2; i++) {
      const output = join(f.directory, `sequence-${i}.zip`);
      const result = await f.read('sequence-export', ['--expected-revision', '12', '--output', output]);
      expect(result.json).toMatchObject({ ok: true, receipt: { revision: 12, sequenceId: 'story', canonicalDigest: final.canonicalDigest } });
      bytes.push(await readFile(output)); expect(result.json.archiveDigest).toBe(sha256Hex(bytes[i]!));
      expect(Object.keys(unzipSync(bytes[i]!))).toEqual(['animation.html', 'animation.css', 'receipt.json']);
      expect(strFromU8(unzipSync(bytes[i]!)['receipt.json']!)).toContain(final.canonicalDigest);
      expect(result.stdout + result.stderr).not.toContain(output); expect(result.stdout).not.toContain('<html');
      expect(result.stdout + result.stderr).not.toContain(f.capability);
    }
    expect(bytes[0]).toEqual(bytes[1]);
    expect((await f.read('sequence-export', ['--expected-revision', '12', '--output', join(f.directory, 'sequence-0.zip')])).json.code).toBe('EXPORT_OUTPUT_EXISTS');
    expect(await readFile(join(f.directory, 'sequence-0.zip'))).toEqual(bytes[0]);
    expect((await f.read('sequence-export', ['--expected-revision', '11', '--output', join(f.directory, 'stale.zip')])).json.code).toBe('SEQUENCE_STALE_REVISION');
    expect(await readdir(f.directory)).not.toContain('stale.zip');
    const privateDirectory = join(dirname(f.sessionPath), 'agent-sequence-claims', 'story');
    expect((await stat(privateDirectory)).mode & 0o777).toBe(0o700);
    for (const file of await readdir(privateDirectory)) expect((await stat(join(privateDirectory, file))).mode & 0o777).toBe(0o600);
  } finally { await f.cleanup(); }
}, 45_000);

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
