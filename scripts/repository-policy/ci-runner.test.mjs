import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { verificationJobNames } from './ci-policy.mjs';

const exec = promisify(execFile);
const execute = async (args, options) => {
  try { return { status: 0, ...await exec(process.execPath, args, options) }; }
  catch (error) { return { status: error.code, stdout: error.stdout, stderr: error.stderr }; }
};
const runner = fileURLToPath(new URL('../ci-verification.mjs', import.meta.url));

test('real Git path evidence includes deletions and renames, and wrong checkout fails closed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'motion-ci-policy-'));
  // Isolate test Git commands from a parent Git hook's index/worktree environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  let remote; let httpStatus = 200;
  const server = createServer((request, response) => {
    response.writeHead(request.headers.authorization === 'Bearer synthetic-ci-token' ? httpStatus : 401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(remote));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const apiEnv = { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'synthetic/example', GITHUB_TOKEN: 'synthetic-ci-token' };
  const git = (...args) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'synthetic@example.invalid');
    writeFileSync(join(directory, 'README.md'), 'Base prose\n');
    writeFileSync(join(directory, 'engine.ts'), 'export const value = 1;\n');
    git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(directory, 'README.md'), 'Edited prose\n');
    git('add', '.'); git('commit', '-qm', 'prose');
    const head = git('rev-parse', 'HEAD');
    const eventPath = join(directory, 'event.json'); const outputPath = join(directory, 'output');
    const run = async (event, options = {}) => {
      remote = { ...event.pull_request, number: event.number, state: 'open', ...options.current };
      writeFileSync(eventPath, JSON.stringify(event)); writeFileSync(outputPath, '');
      return execute([runner, options.command ?? 'plan'], { cwd: directory, encoding: 'utf8',
        env: { ...env, ...apiEnv, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath,
          CI_PLAN_MODE: options.mode, CI_JOB_RESULTS: JSON.stringify(options.needs ?? {}) } });
    };
    const event = { number: 7, action: 'synchronize', pull_request: { draft: true, base: { sha: base }, head: { sha: head } } };
    const prose = await run(event); assert.equal(prose.status, 0, prose.stderr);
    assert.deepEqual(JSON.parse(prose.stdout), { mode: 'prose' });
    assert.equal(readFileSync(outputPath, 'utf8'), 'mode=prose\n');
    git('mv', 'engine.ts', 'engine.md'); git('commit', '-qm', 'rename code');
    assert.equal((await run(event)).stderr.trim(), 'CI_CHECKOUT_IDENTITY_MISMATCH');
    event.pull_request.head.sha = git('rev-parse', 'HEAD');
    assert.deepEqual(JSON.parse((await run(event)).stdout), { mode: 'smoke' });
    git('rm', 'engine.md'); git('commit', '-qm', 'delete renamed code');
    event.pull_request.head.sha = git('rev-parse', 'HEAD'); event.pull_request.draft = false;
    assert.deepEqual(JSON.parse((await run(event)).stdout), { mode: 'full' });
    const beforeRebase = event.pull_request.head.sha;
    git('checkout', '-qb', 'newer-base', base);
    writeFileSync(join(directory, 'base-only.txt'), 'Independent base change\n');
    git('add', 'base-only.txt'); git('commit', '-qm', 'advance base');
    const newerBase = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'rebased-topic', beforeRebase);
    git('rebase', 'newer-base');
    event.pull_request.base.sha = newerBase;
    event.pull_request.head.sha = git('rev-parse', 'HEAD');
    assert.notEqual(event.pull_request.head.sha, beforeRebase);
    assert.deepEqual(JSON.parse((await run(event)).stdout), { mode: 'full' });
    // Reruns retain their draft event payload; live readiness must win.
    event.pull_request.draft = true;
    assert.deepEqual(JSON.parse((await run(event, { current: { draft: false } })).stdout), { mode: 'full' });
    const stalePlan = await run(event, { command: 'gate', mode: 'smoke', current: { draft: false } });
    assert.equal(stalePlan.status, 1); assert.equal(stalePlan.stderr.trim(), 'CI_PR_PLAN_CHANGED');
    const changedHead = await run(event, { current: { head: { sha: base } } });
    assert.equal(changedHead.status, 1); assert.equal(changedHead.stderr.trim(), 'CI_PR_HEAD_CHANGED');
    httpStatus = 503;
    const unavailable = await run(event);
    assert.equal(unavailable.status, 1); assert.equal(unavailable.stderr.trim(), 'CI_PR_LOOKUP_FAILED');
    assert.ok(!unavailable.stderr.includes(apiEnv.GITHUB_TOKEN));
    httpStatus = 200;
    event.pull_request.head.sha = 'not-a-commit';
    const bad = await run(event); assert.equal(bad.status, 1); assert.equal(bad.stderr.trim(), 'CI_COMMIT_IDENTITY_INVALID');
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('actual aggregate command propagates failed, canceled, or missing required checks', () => {
  const needs = Object.fromEntries(verificationJobNames.map((name) => [name,
    { result: name === 'smoke' ? 'skipped' : 'success' }]));
  const run = (values, mode = 'full') => spawnSync(process.execPath, [runner, 'gate'], { encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', CI_PLAN_MODE: mode, CI_JOB_RESULTS: JSON.stringify(values) } });
  assert.equal(run(needs).status, 0);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const bad = run({ ...needs, browser: { result } });
    assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).passed, false);
  }
  const { scope, ...missing } = needs;
  assert.equal(run(missing).status, 1);
  assert.equal(run(needs, '').status, 1);
});
