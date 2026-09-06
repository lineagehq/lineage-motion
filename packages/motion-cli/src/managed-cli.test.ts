import { expect, test } from 'vitest';
import { parseArgumentValues } from './arguments.ts';
import { invoke } from './managed-test-support.ts';

test('every advertised public command has real subprocess help, including all review commands and claim-secret', async () => {
  const help = await invoke(['help']); expect(help.code).toBe(0);
  const names = [...help.json.reads, ...help.json.utilities, ...help.json.mutations, ...help.json.reviews, ...help.json.projectMutations]
    .map((entry: {name: string}) => entry.name);
  expect(new Set(names).size).toBe(names.length);
  for (const name of ['review-dispatch', 'review-annotations', 'review-compare', 'review-handoff', 'claim-secret', 'projects'])
    expect(names).toContain(name);
  for (let offset = 0; offset < names.length; offset += 4) {
    const batch = names.slice(offset, offset + 4);
    const results = await Promise.all(batch.map((name) => invoke([name, '--help'])));
    for (const [index, result] of results.entries()) expect(result, batch[index]).toMatchObject({
      code: 0, stderr: '', json: { schemaVersion: 'motion.cli-command.v1', name: batch[index] } });
  }
  for (const args of Object.values(help.json.examples) as string[][]) {
    const expanded = args.map((arg) => arg.replace('{documentId}', 'synthetic_doc').replace('{revision}', '0')
      .replace('{elementId}', 'synthetic_element').replace('{leaseVersion}', '1'));
    expect(() => parseArgumentValues(expanded)).not.toThrow();
  }
  expect(help.stdout).not.toContain('--claim-secret <');
}, 20_000);
test('offline help and utilities reject extra, unknown or duplicate flags instead of silently ignoring them', async () => {
  for (const args of [['help', 'extra'], ['head', '--help', '--capability', 'private-sentinel'],
    ['claim-secret', '--unknown'], ['operation-kinds', '--unknown', 'private-sentinel'],
    ['operation-kinds', '--service', 'one', '--service', 'two']]) {
    const result = await invoke(args); expect(result.code).toBe(2);
    expect(result.stdout + result.stderr).not.toContain('private-sentinel');
  }
});
