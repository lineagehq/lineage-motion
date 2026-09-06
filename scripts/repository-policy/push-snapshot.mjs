import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withoutInheritedGitEnvironment } from './git-environment.mjs';

export const cleanEnvironment = () => ({ ...withoutInheritedGitEnvironment(), HUSKY: '0' });
export const git = (root, args) => execFileSync('git', args, {
  cwd: root, env: cleanEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 32 * 1024 * 1024,
}).trim();

const running = new Set();
const pendingInstalls = new Set();
let shuttingDown = false;
async function stopRunning() {
  shuttingDown = true;
  const signal = (child, kind) => {
    try { process.kill(-child.pid, kind); } catch { /* Process group already exited. */ }
  };
  await Promise.all([...running].map((child) => new Promise((done) => {
    const finish = () => { clearTimeout(timer); signal(child, 'SIGKILL'); done(); };
    const timer = setTimeout(() => signal(child, 'SIGKILL'), 250);
    child.once('exit', finish);
    child.once('error', finish);
    signal(child, 'SIGTERM');
  })));
}

export function run(command, args, cwd) {
  if (shuttingDown) return Promise.resolve(1);
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env: cleanEnvironment(), stdio: 'inherit', detached: true });
    running.add(child);
    child.once('error', (error) => { running.delete(child); reject(error); });
    child.once('exit', (code, signal) => {
      running.delete(child);
      resolveResult(shuttingDown ? 1 : code ?? (signal ? 1 : 0));
    });
  });
}

async function dependencies(root, snapshot) {
  const packageBytes = readFileSync(join(snapshot, 'package.json'));
  const lockBytes = readFileSync(join(snapshot, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  // Workspace installs must resolve packages in this exact snapshot. Never share
  // a node_modules tree containing repository links with a different checkout.
  if (Object.entries(lock.packages ?? {}).some(([path, entry]) => entry.link || path.startsWith('packages/'))) {
    if (await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], snapshot)) {
      throw new Error('Snapshot dependency installation failed.');
    }
    return;
  }
  const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  const key = createHash('sha256').update(packageBytes).update(lockBytes)
    .update([process.version, process.platform, process.arch, npmVersion].join('/')).digest('hex');
  const common = resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  const cache = join(common, 'motion-hook-dependencies');
  mkdirSync(cache, { recursive: true });
  const installed = join(cache, key);
  if (!existsSync(installed)) {
    const pending = mkdtempSync(join(cache, 'install-'));
    pendingInstalls.add(pending);
    try {
      writeFileSync(join(pending, 'package.json'), packageBytes);
      writeFileSync(join(pending, 'package-lock.json'), lockBytes);
      if (await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], pending)) {
        throw new Error('Dependency cache installation failed.');
      }
      try { renameSync(pending, installed); } catch (error) {
        if (!existsSync(installed)) throw error;
      }
    } finally { rmSync(pending, { recursive: true, force: true }); pendingInstalls.delete(pending); }
  }
  symlinkSync(join(installed, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
}

export async function withPushSnapshot(root, tip, verify) {
  const parent = mkdtempSync(join(tmpdir(), 'motion-push-'));
  const snapshot = join(parent, 'tree');
  const cleanup = () => {
    try { git(root, ['worktree', 'remove', '--force', snapshot]); } catch { /* Removed below. */ }
    rmSync(parent, { force: true, recursive: true });
  };
  // Normal completion and signals clean up this one owned worktree, never prune
  // or change another worktree's hooks/configuration.
  const interrupted = () => {
    void stopRunning().finally(() => {
      for (const pending of pendingInstalls) rmSync(pending, { recursive: true, force: true });
      cleanup(); process.exit(1);
    });
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    git(root, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', snapshot, tip]);
    await dependencies(root, snapshot);
    return await verify(snapshot);
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    cleanup();
  }
}
