import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';

import { verificationSuites } from './verification-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const vitestCli = resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs');
const leakPath = resolve(repositoryRoot, '.worktrees/discovery-leak/packages/leak.test.ts');

test.afterEach(() => {
  rmSync(resolve(repositoryRoot, '.worktrees/discovery-leak'), { force: true, recursive: true });
});

test('the repository configuration excludes sibling worktrees', () => {
  mkdirSync(dirname(leakPath), { recursive: true });
  writeFileSync(leakPath, "import { test } from 'vitest';\ntest('leak', () => {});\n");

  const discovered = listTests('vitest.config.ts');

  assert.equal(discovered.includes('.worktrees/discovery-leak/packages/leak.test.ts'), false);
});

test('the fast configuration lists exactly its manifest-owned files', () => {
  const expected = [...verificationSuites['fast-unit'].files].sort();

  assert.deepEqual(listTests('vitest.fast.config.ts'), expected);
  assert.equal(expected.some((path) => path.includes('acquisition.test.ts')), false);
  assert.equal(expected.some((path) => path.includes('local-service')), false);
});

function listTests(config) {
  const output = execFileSync(process.execPath, [
    vitestCli,
    'list',
    '--filesOnly',
    '--config',
    config,
  ], { cwd: repositoryRoot, encoding: 'utf8' });

  return output.trim().split('\n').filter(Boolean).map((path) => (
    relative(repositoryRoot, path).replaceAll('\\', '/')
  )).sort();
}
