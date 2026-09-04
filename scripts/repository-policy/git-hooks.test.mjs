import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);
const readRepositoryFile = (path) => readFile(new URL(path, repositoryRoot), 'utf8');
const execFileAsync = promisify(execFile);

test('package installation prepares Husky hooks', async () => {
  const packageJson = JSON.parse(await readRepositoryFile('package.json'));
  assert.equal(packageJson.scripts.prepare, 'husky');
  assert.match(packageJson.devDependencies.husky, /^\^9\./);
  assert.match(packageJson.devDependencies.tsx, /^\^4\./);
});

test('pre-commit rejects line-limit and verification-manifest drift', async () => {
  const hook = await readRepositoryFile('.husky/pre-commit');
  assert.match(hook, /npm run check:line-limit/);
  assert.match(hook, /npm run check:verification-manifest/);
  assert.match(hook, /npm run check:execution-artifacts/);
  assert.notEqual((await stat(new URL('.husky/pre-commit', repositoryRoot))).mode & 0o111, 0);
});

test('pre-push runs the complete fast tier', async () => {
  const hook = await readRepositoryFile('.husky/pre-push');
  assert.match(hook, /npm run verify:fast/);
  assert.notEqual((await stat(new URL('.husky/pre-push', repositoryRoot))).mode & 0o111, 0);
});

test('CI exposes stable, non-overlapping verification jobs', async () => {
  const workflow = await readRepositoryFile('.github/workflows/verification.yml');
  for (const job of [
    'policy-fast',
    'integration',
    'recovery-parity',
    'determinism-visual',
    'browser',
    'typecheck-build',
  ]) {
    assert.match(workflow, new RegExp(`^  ${job}:$`, 'm'));
  }
  assert.equal(workflow.match(/npm run check:line-limit/g)?.length, 1);
  assert.equal(workflow.match(/npm run check:verification-manifest/g)?.length, 1);
  assert.equal(workflow.match(/npm run check:execution-artifacts/g)?.length, 1);
  for (const suite of [
    'policy-tests',
    'fast-unit',
    'repository-safety',
    'service-integration',
    'acquisition',
    'recovery',
    'parity',
    'determinism',
    'public-visual',
    'browser',
    'typecheck',
    'build',
    'privacy-checks',
  ]) {
    assert.equal(workflow.match(new RegExp(`--suite ${suite}(?:\\s|$)`, 'g'))?.length, 1, suite);
  }
  assert.doesNotMatch(workflow, /private-acceptance|private\.test|private\.visual/);
  const integrationJob = workflow.match(/^  integration:\n([\s\S]*?)(?=^  [a-z][a-z-]*:\n)/m)?.[1] ?? '';
  assert.match(integrationJob, /npx playwright install --with-deps chromium/);
});

test('test servers launch vite-node directly so termination reaches the service process', async () => {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('git', [
      'grep',
      '-n',
      '-F',
      "spawn('npm', ['exec', 'vite-node'",
      '--',
      'apps/editor',
    ], { cwd: repositoryRoot }));
  } catch (error) {
    if (error.code !== 1) throw error;
    stdout = error.stdout ?? '';
  }
  assert.equal(stdout, '', `indirect vite-node launchers can orphan services:\n${stdout}`);
});
