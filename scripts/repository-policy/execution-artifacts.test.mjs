import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { withoutInheritedGitEnvironment } from './git-environment.mjs';

const checker = resolve(import.meta.dirname, '../check-execution-artifacts.mjs');

test('allows ignored local goal artifacts while keeping the tracked tree clean', (context) => {
  const repository = committedRepository({
    '.gitignore': 'docs/goals/\n',
    'README.md': 'fixture\n',
  });
  context.after(() => rmSync(repository, { force: true, recursive: true }));
  writeFixture(repository, 'docs/goals/local/state.yaml', 'status: local\n');

  const result = runChecker(repository);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 'motion.execution-artifact-check.v1',
    passed: true,
    ignored: true,
    trackedPaths: [],
  });
});

test('rejects a force-added goal artifact even when the directory is ignored', (context) => {
  const repository = committedRepository({
    '.gitignore': 'docs/goals/\n',
    'docs/evidence/product-receipt.json': '{}\n',
  });
  context.after(() => rmSync(repository, { force: true, recursive: true }));
  writeFixture(repository, 'docs/goals/forced/notes/T001-receipt.json', '{}\n');
  git(repository, ['add', '--force', 'docs/goals/forced/notes/T001-receipt.json']);
  git(repository, ['commit', '--quiet', '-m', 'force artifact']);

  const result = runChecker(repository);

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 'motion.execution-artifact-check.v1',
    passed: false,
    ignored: true,
    trackedPaths: ['docs/goals/forced/notes/T001-receipt.json'],
  });
});

function runChecker(repository) {
  return spawnSync(process.execPath, [checker], { cwd: repository, encoding: 'utf8' });
}

function committedRepository(files) {
  const repository = mkdtempSync(join(tmpdir(), 'motion-execution-artifacts-'));
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'user.email', 'policy@example.invalid']);
  git(repository, ['config', 'user.name', 'Policy Test']);
  for (const [path, contents] of Object.entries(files)) writeFixture(repository, path, contents);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'fixture']);
  return repository;
}

function writeFixture(repository, path, contents) {
  const absolute = join(repository, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function git(repository, args) {
  execFileSync('git', args, {
    cwd: repository,
    env: withoutInheritedGitEnvironment(),
    stdio: 'ignore',
  });
}
