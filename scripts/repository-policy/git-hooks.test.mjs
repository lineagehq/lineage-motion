import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { verificationTiers, verificationSuites } from './verification-manifest.mjs';
import { verificationJobNames } from './ci-policy.mjs';

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
  assert.match(hook, /node scripts\/check-staged\.mjs/);
  assert.notEqual((await stat(new URL('.husky/pre-commit', repositoryRoot))).mode & 0o111, 0);
});

test('pre-push runs the complete fast tier', async () => {
  const hook = await readRepositoryFile('.husky/pre-push');
  assert.match(hook, /node scripts\/check-push\.mjs/);
  assert.notEqual((await stat(new URL('.husky/pre-push', repositoryRoot))).mode & 0o111, 0);
});

test('CI selection preserves complete ready-PR coverage and a bounded draft smoke', async () => {
  const workflow = await readRepositoryFile('.github/workflows/verification.yml');
  const jobs = Object.fromEntries([...workflow.split('\njobs:\n')[1].matchAll(/^  ([a-z][a-z-]*):\n([\s\S]*?)(?=^  [a-z][a-z-]*:|$(?![\s\S]))/gm)]
    .map((match) => [match[1], match[2]]));
  assert.deepEqual(Object.keys(jobs).sort(), [...verificationJobNames, 'verification-gate'].sort());
  assert.match(jobs.scope, /fetch-depth: 0/);
  assert.match(jobs.scope, /node scripts\/ci-verification.mjs plan/);
  assert.match(jobs['verification-gate'], /name:.*mode == 'smoke'.*'draft-smoke-gate'.*'verification-gate'/);
  assert.match(jobs['verification-gate'], /fetch-depth: 0/);
  assert.match(workflow, /head.sha \|\| github.sha.*draft.*ready/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(jobs.scope, /GITHUB_TOKEN:/);
  assert.match(jobs['verification-gate'], /GITHUB_TOKEN:/);
  assert.match(jobs['verification-gate'], /if: always\(\)/);
  assert.match(jobs['verification-gate'], /node scripts\/ci-verification.mjs gate/);
  for (const name of verificationJobNames) assert.ok(jobs['verification-gate'].includes(name));
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft, edited\]/);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /^  schedule:/m);
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.match(jobs['policy-fast'], /node scripts\/check-staged.mjs/);
  assert.match(jobs['typecheck-build'], /if: needs.scope.outputs.mode != 'prose'/);
  assert.match(jobs.smoke, /if: needs.scope.outputs.mode == 'smoke'/);
  const suites = (names) => names.flatMap((name) => [...jobs[name].matchAll(/--suite ([a-z-]+)/g)].map((match) => match[1]));
  assert.deepEqual(suites(['smoke']).sort(), ['browser-smoke', 'determinism']);
  const fullJobs = ['integration', 'recovery-parity', 'determinism-visual', 'browser'];
  for (const name of fullJobs) assert.match(jobs[name], /if: needs.scope.outputs.mode == 'full'/);
  const full = suites(['policy-fast', 'typecheck-build', ...fullJobs]);
  // The staged checker supplies these three policies in one exact-content pass.
  const expected = verificationTiers.pr.filter((name) => !['line-limit', 'manifest-policy', 'execution-artifacts'].includes(name));
  assert.deepEqual(full.sort(), expected.sort());
  assert.equal(new Set(full).size, full.length, 'ready PR leaves must run once');
  for (const name of ['browser', 'browser-smoke']) {
    const suite = verificationSuites[name];
    assert.deepEqual(suite.args.slice(4), suite.files, 'browser selection must execute its owned files only');
    assert.match(jobs[name === 'browser' ? 'browser' : 'smoke'], /npx playwright install --with-deps chromium/);
  }
  assert.doesNotMatch(workflow, /private-acceptance|private\.test|private\.visual/);
  for (const name of ['smoke', 'browser']) {
    assert.match(jobs[name], /server-diagnostics/);
    assert.doesNotMatch(jobs[name], /trace\.zip|path: apps\/editor\/test-results\s*$/m);
  }
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
