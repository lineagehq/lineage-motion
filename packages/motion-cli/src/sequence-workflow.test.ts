import { expect, test } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
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
