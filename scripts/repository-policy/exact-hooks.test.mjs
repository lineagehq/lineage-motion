import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { withoutInheritedGitEnvironment } from './git-environment.mjs';
import { parsePushInput, selectPushSuites } from './push-selection.mjs';

const source = resolve(import.meta.dirname, '../..');
const temporary = [];
const env = withoutInheritedGitEnvironment();
const zeros = '0'.repeat(40);
const git = (root, ...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const run = (root, file, input = '') => spawnSync('node', [join(source, file)], {
  cwd: root, env, input, encoding: 'utf8', timeout: 60_000,
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'motion-hooks-test-'));
  temporary.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'hooks@example.invalid');
  git(root, 'config', 'user.name', 'Hook Test');
  for (const file of ['check-staged.mjs', 'check-push.mjs', ...[
    'staged-tree', 'push-selection', 'push-snapshot', 'git-environment', 'line-limit',
    'tracked-files', 'verification-policy',
  ].map((name) => `repository-policy/${name}.mjs`)]) {
    put(root, `scripts/${file}`, readFileSync(join(source, 'scripts', file)));
  }
  put(root, '.gitignore', 'docs/goals/\nnode_modules/\n');
  put(root, 'package.json', '{"name":"hook-fixture","version":"1.0.0","private":true}');
  put(root, 'package-lock.json', JSON.stringify({
    name: 'hook-fixture', version: '1.0.0', lockfileVersion: 3,
    packages: { '': { name: 'hook-fixture', version: '1.0.0' } },
  }));
  put(root, 'scripts/repository-policy/verification-manifest.mjs',
    'export const verificationSuites = {}; export const verificationTiers = {};\n');
  put(root, 'scripts/run-verification.mjs', `
import { readFileSync, existsSync } from 'node:fs';
if (existsSync('reject') && readFileSync('reject', 'utf8') === 'bad') process.exit(1);
console.log('fixture leaf ' + process.argv.slice(2).join(' '));
`);
  put(root, 'README.md', 'synthetic fixture\n');
  git(root, 'add', '.');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  return root;
}
const stage = (root, path, text) => { put(root, path, text); git(root, 'add', '-f', path); };
function commit(root) {
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-qam', 'fixture change');
  return git(root, 'rev-parse', 'HEAD');
}
function installHook(root, name) {
  mkdirSync(join(root, '.husky'), { recursive: true });
  cpSync(join(source, '.husky', name), join(root, '.husky', name));
  chmodSync(join(root, '.husky', name), 0o755);
  git(root, 'config', 'core.hooksPath', '.husky');
}
test.afterEach(() => { while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true }); });

test('real commit hook rejects bad staged bytes and preserves good unstaged bytes', () => {
  const root = fixture();
  installHook(root, 'pre-commit');
  stage(root, 'README.md', '/' + ['Users', 'synthetic', 'private'].join('/'));
  put(root, 'README.md', 'clean worktree\n');
  const before = git(root, 'write-tree');
  assert.throws(() => git(root, 'commit', '-qm', 'must fail'));
  assert.equal(git(root, 'write-tree'), before);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'clean worktree\n');
});

test('real commit hook accepts safe staged bytes while preserving bad unstaged bytes', () => {
  const root = fixture();
  installHook(root, 'pre-commit');
  stage(root, 'README.md', 'safe staged edit\n');
  const unstaged = '/' + ['Users', 'synthetic', 'private'].join('/');
  put(root, 'README.md', unstaged);
  git(root, 'commit', '-qm', 'safe staged');
  assert.equal(git(root, 'show', 'HEAD:README.md'), 'safe staged edit');
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), unstaged);
});

test('staged checks reject forbidden, oversized, credential, and unowned test blobs', () => {
  const root = fixture();
  const credential = ['api', 'key'].join('_') + ' = "synthetic-secret-value"';
  const cases = [
    ['docs/goals/state.yaml', 'local'], ['private.sqlite', Buffer.from([0, 1])],
    ['screenshots/image.png', Buffer.from([0, 1])], ['large.txt', 'x'.repeat(5 * 1024 * 1024 + 1)],
    ['scripts/long.mjs', '\n'.repeat(501)], ['README.md', credential], ['unowned.test.ts', 'export {};'],
  ];
  for (const [path, bytes] of cases) {
    stage(root, path, bytes);
    const result = run(root, 'scripts/check-staged.mjs');
    assert.equal(result.status, 1, path + result.stdout + result.stderr);
    git(root, 'restore', '--staged', path);
  }
});

test('manifest consistency uses staged definitions; renames and deletions have no stale inventory', () => {
  const root = fixture();
  const manifest = 'scripts/repository-policy/verification-manifest.mjs';
  stage(root, 'owned.test.ts', 'export {};');
  stage(root, manifest, 'export const verificationSuites={unit:{files:["owned.test.ts"]}}; export const verificationTiers={};');
  put(root, manifest, 'broken unstaged code');
  assert.equal(run(root, 'scripts/check-staged.mjs').status, 0);
  put(root, manifest, git(root, 'show', `:${manifest}`));
  commit(root);
  git(root, 'mv', 'owned.test.ts', 'renamed.test.ts');
  assert.equal(run(root, 'scripts/check-staged.mjs').status, 1);
  git(root, 'rm', '-f', 'renamed.test.ts');
  stage(root, manifest, 'export const verificationSuites={}; export const verificationTiers={};');
  assert.equal(run(root, 'scripts/check-staged.mjs').status, 0);
});

test('pre-push parses multiple refs, deletes, malformed input and conservative paths', () => {
  const sha = 'a'.repeat(40);
  assert.equal(parsePushInput(`refs/heads/a ${sha} refs/heads/a ${zeros}\n: ${zeros} refs/heads/b ${sha}\n`).length, 1);
  assert.throws(() => parsePushInput('refs/heads/a not-a-sha refs/heads/a nope'));
  for (const paths of [null, ['package-lock.json'], ['unknown'], ['docs/run.mjs'], ['packages/domain/src/index.ts']]) {
    assert.deepEqual(selectPushSuites(paths), ['typecheck', 'build', 'determinism', 'service-integration', 'parity']);
  }
  assert.deepEqual(selectPushSuites(['README.md', 'apps/editor/src/main.css']), ['typecheck', 'build', 'determinism']);
});

test('actual push blocks alternate bad tips and multi-ref updates from a clean checkout', () => {
  const root = fixture();
  const good = git(root, 'rev-parse', 'HEAD');
  stage(root, 'reject', 'bad');
  const bad = commit(root);
  git(root, 'branch', 'bad-tip', bad);
  git(root, 'checkout', '--detach', good);
  installHook(root, 'pre-push');
  const remote = join(root, 'remote.git');
  git(root, 'init', '--bare', '-q', remote);
  assert.throws(() => git(root, 'push', remote, 'bad-tip:refs/heads/bad'));
  assert.equal(git(remote, 'for-each-ref'), '');
  assert.throws(() => git(root, 'push', remote, 'HEAD:refs/heads/good', 'bad-tip:refs/heads/bad'));
  assert.equal(git(remote, 'for-each-ref'), '');
  assert.equal(git(root, 'rev-parse', 'HEAD'), good);
  assert.equal(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});

test('new branches verify all leaves; deletion-only input does not install or test', () => {
  const root = fixture();
  const tip = git(root, 'rev-parse', 'HEAD');
  const result = run(root, 'scripts/check-push.mjs', `refs/heads/new ${tip} refs/heads/new ${zeros}\n`);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const leaf of ['--tier fast', '--suite typecheck', '--suite build', '--suite determinism', '--suite service-integration', '--suite parity']) {
    assert.ok(result.stdout.includes(leaf), leaf);
  }
  const deletion = run(root, 'scripts/check-push.mjs', `: ${zeros} refs/heads/new ${tip}\n`);
  assert.equal(deletion.status, 0);
  assert.doesNotMatch(deletion.stdout, /fixture leaf|added/);
});

test('shared worktree push leaves config, original index and unstaged work untouched', () => {
  const root = fixture();
  const other = join(root, 'other');
  git(root, 'worktree', 'add', '--detach', other, 'HEAD');
  put(other, 'README.md', 'unstaged worktree edit');
  const config = readFileSync(join(root, '.git', 'config'));
  const before = git(other, 'write-tree');
  const tip = git(other, 'rev-parse', 'HEAD');
  const result = run(other, 'scripts/check-push.mjs', `HEAD ${tip} refs/heads/new ${zeros}\n`);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(readFileSync(join(root, '.git', 'config')), config);
  assert.equal(git(other, 'write-tree'), before);
  assert.equal(readFileSync(join(other, 'README.md'), 'utf8'), 'unstaged worktree edit');
  assert.equal(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2);
});

test('workspace dependencies resolve pushed source, never the working checkout', () => {
  const root = fixture();
  stage(root, 'package.json', '{"name":"hook-fixture","version":"1.0.0","private":true,"workspaces":["packages/*"]}');
  stage(root, 'packages/source/package.json', '{"name":"fixture-source","version":"1.0.0","main":"index.js"}');
  stage(root, 'packages/source/index.js', 'module.exports = "bad";');
  stage(root, 'package-lock.json', JSON.stringify({
    name: 'hook-fixture', version: '1.0.0', lockfileVersion: 3,
    packages: {
      '': { name: 'hook-fixture', version: '1.0.0', workspaces: ['packages/*'] },
      'packages/source': { name: 'fixture-source', version: '1.0.0' },
      'node_modules/fixture-source': { resolved: 'packages/source', link: true },
    },
  }));
  stage(root, 'scripts/run-verification.mjs', 'import value from "fixture-source"; console.log("workspace exact bytes " + value); process.exit(value === "bad" ? 1 : 0);');
  const tip = commit(root);
  put(root, 'packages/source/index.js', 'module.exports = "good";');
  const result = run(root, 'scripts/check-push.mjs', `HEAD ${tip} refs/heads/new ${zeros}\n`);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /workspace exact bytes bad/);
  assert.equal(readFileSync(join(root, 'packages/source/index.js'), 'utf8'), 'module.exports = "good";');
});


test('interrupting push stops verification processes and removes its snapshot', async () => {
  const root = fixture();
  stage(root, 'scripts/run-verification.mjs',
    'console.log("running-pid:" + process.pid); setInterval(() => {}, 1000);');
  const tip = commit(root);
  const child = spawn('node', [join(source, 'scripts/check-push.mjs')], { cwd: root, env });
  child.stdin.end(`HEAD ${tip} refs/heads/new ${zeros}\n`);
  let output = '';
  child.stderr.resume();
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  await new Promise((resolveReady, reject) => {
    const deadline = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('No verifier startup')); }, 10000);
    child.stdout.on('data', (bytes) => {
      output += bytes;
      if ((output.match(/running-pid:/g) ?? []).length === 6) {
        clearTimeout(deadline); resolveReady();
      }
    });
  });
  child.kill('SIGTERM');
  assert.equal(await exited, 1);
  for (const [, pid] of output.matchAll(/running-pid:(\d+)/g)) {
    let alive = true;
    for (let retry = 0; retry < 20 && alive; retry += 1) {
      try { process.kill(Number(pid), 0); await new Promise((done) => setTimeout(done, 50)); }
      catch { alive = false; }
    }
    assert.equal(alive, false, 'Verifier must stop on interruption');
  }
  assert.equal(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});


test('cold-install interruption removes only its own staging directory and stops npm', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const root = fixture();
    const bin = join(root, 'fake-bin');
    put(root, 'fake-bin/npm', '#!/usr/bin/env node\n' +
      'if(process.argv.includes("--version")){console.log("test-npm");process.exit(0);}' +
      'process.on("SIGTERM",()=>{});' +
      'require("node:fs").mkdirSync("node_modules",{recursive:true});' +
      'console.log("install-pid:"+process.pid);setInterval(()=>{},1000);');
    chmodSync(join(bin, 'npm'), 0o755);
    const cache = join(root, '.git', 'motion-hook-dependencies');
    mkdirSync(join(cache, 'install-unrelated'), { recursive: true });
    const tip = git(root, 'rev-parse', 'HEAD');
    const child = spawn('node', [join(source, 'scripts/check-push.mjs')], {
      cwd: root, env: { ...env, PATH: bin + ':' + env.PATH },
    });
    child.stdin.end(`HEAD ${tip} refs/heads/new ${zeros}\n`);
    child.stderr.resume();
    const exited = new Promise((done) => child.once('exit', done));
    let npmPid;
    try {
      npmPid = await new Promise((ready, reject) => {
        const deadline = setTimeout(() => reject(new Error('No cold install startup')), 10000);
        child.stdout.on('data', (bytes) => {
          const match = bytes.toString().match(/install-pid:(\d+)/);
          if (match) { clearTimeout(deadline); ready(Number(match[1])); }
        });
      });
      assert.equal(readdirSync(cache).length, 2);
      child.kill(signal);
      assert.equal(await exited, 1);
      assert.deepEqual(readdirSync(cache), ['install-unrelated']);
      assert.throws(() => process.kill(npmPid, 0));
      assert.equal(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
    } finally {
      child.kill('SIGKILL');
      if (npmPid) { try { process.kill(-npmPid, 'SIGKILL'); } catch {} }
    }
  }
});
