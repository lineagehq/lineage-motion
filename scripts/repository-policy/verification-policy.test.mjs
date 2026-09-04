import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  discoverTrackedTests,
  validateVerificationManifest,
} from './verification-policy.mjs';
import { verificationSuites, verificationTiers } from './verification-manifest.mjs';

const temporaryRepositories = [];

test.afterEach(() => {
  while (temporaryRepositories.length > 0) {
    rmSync(temporaryRepositories.pop(), { force: true, recursive: true });
  }
});

test('discovers tests only from the tracked inventory', () => {
  const repository = committedRepository({
    '.gitignore': '.worktrees/\n',
    'packages/example/src/owned.test.ts': 'export {};\n',
    'apps/editor/tests/owned.spec.ts': 'export {};\n',
  });
  writeFixture(repository, '.worktrees/other/packages/leak.test.ts', 'export {};\n');

  assert.deepEqual(discoverTrackedTests(repository), [
    'apps/editor/tests/owned.spec.ts',
    'packages/example/src/owned.test.ts',
  ]);
});

test('rejects unowned and multiply owned test files', () => {
  const repository = committedRepository({
    'packages/example/src/duplicate.test.ts': 'export {};\n',
    'packages/example/src/unowned.test.ts': 'export {};\n',
  });
  const suites = {
    first: suite(['packages/example/src/duplicate.test.ts']),
    second: suite(['packages/example/src/duplicate.test.ts']),
  };

  assert.deepEqual(validateVerificationManifest(repository, suites, {
    fast: ['first'],
    pr: ['first'],
    full: ['first', 'second'],
  }), {
    passed: false,
    unowned: ['packages/example/src/unowned.test.ts'],
    multiplyOwned: [{
      path: 'packages/example/src/duplicate.test.ts',
      suites: ['first', 'second'],
    }],
    unknownNodes: [],
    privateInPublic: [],
  });
});

test('rejects unknown tier nodes and private suites in the public tier', () => {
  const repository = committedRepository({
    'packages/example/src/public.test.ts': 'export {};\n',
    'packages/example/src/private.private.test.ts': 'export {};\n',
  });
  const suites = {
    public: suite(['packages/example/src/public.test.ts']),
    private: suite(['packages/example/src/private.private.test.ts'], false),
  };

  assert.deepEqual(validateVerificationManifest(repository, suites, {
    fast: ['public'],
    pr: ['public', 'private', 'missing'],
    full: ['public', 'private'],
  }), {
    passed: false,
    unowned: [],
    multiplyOwned: [],
    unknownNodes: ['missing'],
    privateInPublic: ['private'],
  });
});

test('assigns every repository test to exactly one primary suite', () => {
  assert.deepEqual(
    validateVerificationManifest(resolve(import.meta.dirname, '../..'), verificationSuites, verificationTiers),
    {
      passed: true,
      unowned: [],
      multiplyOwned: [],
      unknownNodes: [],
      privateInPublic: [],
    },
  );
});

function suite(files, isPublic = true) {
  return {
    kind: 'node',
    command: 'node',
    args: ['--test', ...files],
    files,
    public: isPublic,
    fast: isPublic,
  };
}

function committedRepository(files) {
  const repository = mkdtempSync(join(tmpdir(), 'motion-verification-policy-'));
  temporaryRepositories.push(repository);
  execFileSync('git', ['init', '--quiet'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'policy@example.invalid'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Policy Test'], { cwd: repository });
  for (const [path, contents] of Object.entries(files)) {
    writeFixture(repository, path, contents);
  }
  execFileSync('git', ['add', '--all'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repository });
  return repository;
}

function writeFixture(repository, path, contents) {
  const absolute = join(repository, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}
