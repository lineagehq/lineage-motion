import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  discoverTrackedTests,
  validateVerificationManifest,
} from './verification-policy.mjs';
import { verificationSuites, verificationTiers } from './verification-manifest.mjs';
import { resolveVerificationTier } from './verification-dag.mjs';
import { runRepositoryGit } from './git-environment.mjs';

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

test('compatibility scripts select manifest leaves without aggregate recursion', async () => {
  const packageJson = JSON.parse(await readFileFromRepository('package.json'));
  assert.equal(packageJson.scripts['test:unit'], 'node scripts/run-verification.mjs --suite fast-unit');
  assert.equal(packageJson.scripts['qa:chrome'], 'node scripts/run-verification.mjs --tier qa:chrome');
  assert.equal(packageJson.scripts['verify:phase3'], 'node scripts/run-verification.mjs --tier phase3');
  assert.doesNotMatch(packageJson.scripts['qa:chrome'], /playwright|test:browser|test:phase3:browser/);
  assert.doesNotMatch(packageJson.scripts['verify:phase3'], /&&|npm run/);
});

test('aggregate selections are deduplicated and reserve private suites for full', () => {
  for (const tier of ['fast', 'pr', 'full', 'phase3', 'qa:chrome']) {
    const selected = resolveVerificationTier(tier, verificationSuites, verificationTiers);
    assert.equal(selected.length, new Set(selected).size, tier);
    if (tier !== 'full') {
      assert.equal(selected.some((name) => verificationSuites[name].public === false), false, tier);
    }
  }
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
  runRepositoryGit(repository, ['init', '--quiet']);
  runRepositoryGit(repository, ['config', 'user.email', 'policy@example.invalid']);
  runRepositoryGit(repository, ['config', 'user.name', 'Policy Test']);
  for (const [path, contents] of Object.entries(files)) {
    writeFixture(repository, path, contents);
  }
  runRepositoryGit(repository, ['add', '--all']);
  runRepositoryGit(repository, ['commit', '--quiet', '-m', 'fixture']);
  return repository;
}

function writeFixture(repository, path, contents) {
  const absolute = join(repository, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function readFileFromRepository(path) {
  return import('node:fs/promises').then(({ readFile }) => readFile(
    new URL(`../../${path}`, import.meta.url),
    'utf8',
  ));
}
