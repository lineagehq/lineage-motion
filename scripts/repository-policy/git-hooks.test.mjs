import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);
const readRepositoryFile = (path) => readFile(new URL(path, repositoryRoot), 'utf8');

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
