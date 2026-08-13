import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function run(script: string): Record<string, unknown> {
  return JSON.parse(execFileSync(process.execPath, [script], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })) as Record<string, unknown>;
}

describe('repository safety checks', () => {
  test('proves all private acceptance targets are ignored', () => {
    expect(run('scripts/check-private-ignore.mjs')).toMatchObject({
      schemaVersion: 'motion.private-ignore-check.v1',
      passed: true,
      targetCount: 3,
      ignoredCount: 3,
      trackedPrivateCount: 0,
    });
  });

  test('scans tracked, branch, index, worktree, and untracked surfaces with aggregate-only output', () => {
    const result = run('scripts/check-sensitive.mjs');

    expect(result).toMatchObject({
      schemaVersion: 'motion.sensitive-check.v1',
      passed: true,
      findingCount: 0,
      scanned: {
        trackedInventory: true,
        branchDiff: true,
        index: true,
        worktree: true,
        untracked: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/[/\\](?:Users|home)[/\\]/);
  });
});
