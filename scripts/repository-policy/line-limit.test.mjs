import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  classifyLineLimitedPath,
  inspectLineLimit,
  physicalLineCount,
} from './line-limit.mjs';
import { trackedFiles } from './tracked-files.mjs';
import { runRepositoryGit } from './git-environment.mjs';

const temporaryRepositories = [];

test.afterEach(() => {
  while (temporaryRepositories.length > 0) {
    rmSync(temporaryRepositories.pop(), { force: true, recursive: true });
  }
});

test('rejects a tracked 501-line source file while accepting 500 lines', () => {
  const repository = committedRepository({
    'packages/example/src/pass.ts': repeatedLines(500),
    'packages/example/src/fail.ts': repeatedLines(501),
  });

  assert.deepEqual(inspectLineLimit(repository), {
    passed: false,
    checkedCount: 2,
    violations: [{
      path: 'packages/example/src/fail.ts',
      lines: 501,
      maxLines: 500,
    }],
  });
});

test('counts CRLF and unterminated final lines as physical lines', () => {
  assert.equal(physicalLineCount(Buffer.from('one\r\ntwo\r\n')), 2);
  assert.equal(physicalLineCount(Buffer.from('one\r\ntwo')), 2);
  assert.equal(physicalLineCount(Buffer.from('')), 0);
});

test('exempts generated, documentation, fixture, and binary artifacts', () => {
  const repository = committedRepository({
    'package-lock.json': repeatedLines(501),
    'docs/evidence/receipt.json': repeatedLines(501),
    'fixtures/large.html': repeatedLines(501),
    'apps/editor/src/image.png': Buffer.from([0, 1, 2, 3]),
    'apps/editor/src/small.ts': 'export const value = 1;\n',
  });

  assert.deepEqual(inspectLineLimit(repository), {
    passed: true,
    checkedCount: 1,
    violations: [],
  });
  assert.equal(classifyLineLimitedPath('docs/architecture.md'), 'exempt');
  assert.equal(classifyLineLimitedPath('apps/editor/src/main.ts'), 'included');
});

test('uses only the active repository tracked inventory', () => {
  const repository = committedRepository({
    '.gitignore': '.worktrees/\n',
    'packages/example/src/owned.test.ts': 'export {};\n',
  });
  const sibling = join(repository, '.worktrees', 'other');
  mkdirSync(join(sibling, 'packages', 'example', 'src'), { recursive: true });
  writeFileSync(
    join(sibling, 'packages', 'example', 'src', 'leak.test.ts'),
    repeatedLines(700),
  );

  assert.deepEqual(trackedFiles(repository), [
    '.gitignore',
    'packages/example/src/owned.test.ts',
  ]);
  assert.deepEqual(inspectLineLimit(repository), {
    passed: true,
    checkedCount: 1,
    violations: [],
  });
});

function committedRepository(files) {
  const repository = mkdtempSync(join(tmpdir(), 'motion-line-limit-'));
  temporaryRepositories.push(repository);
  runRepositoryGit(repository, ['init', '--quiet']);
  runRepositoryGit(repository, ['config', 'user.email', 'policy@example.invalid']);
  runRepositoryGit(repository, ['config', 'user.name', 'Policy Test']);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(repository, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  runRepositoryGit(repository, ['add', '--all']);
  runRepositoryGit(repository, ['commit', '--quiet', '-m', 'fixture']);
  return repository;
}

function repeatedLines(count) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}
