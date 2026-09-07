import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionPath } from './session-context.ts';
export const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
export const checkout = resolve(dirname(cliPath), '../../..');
export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'motion-agent-context-'));
  const dataDir = join(directory, 'data'); await mkdir(dataDir, { mode: 0o700 });
  const capability = randomBytes(32).toString('base64url'); const project = 'Synthetic animation';
  const writeSession = async (serviceUrl: string, name = project, cap = capability, cwd = checkout) => {
    const path = sessionPath(name, dataDir, cwd); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ schemaVersion: 'motion.local-session.v1', project: name,
      editorUrl: 'http://127.0.0.1:12345', serviceUrl, agentCapability: cap }), { mode: 0o600 }); return path;
  };
  return { directory, dataDir, capability, project, writeSession, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
export function invoke(args: string[], cwd = checkout): Promise<{ code: number; stdout: string; stderr: string; json: any }> {
  return new Promise((resolve) => execFile(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd, env: { ...process.env, VITEST: '', MOTION_HUMAN_CAPABILITY: '', MOTION_AGENT_CAPABILITY: '' }, timeout: 15_000,
  }, (error, stdout, stderr) => {
    // Never expose execFile's Error: it embeds argv, which explicit callers may fill with credentials.
    resolve({ code: error ? Number(error.code) || 1 : 0, stdout, stderr, json: stdout ? JSON.parse(stdout) : null });
  }));
}
export function startCli(args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: checkout, env: { ...process.env, VITEST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  return { child, closed };
}
export async function readCredential(path: string, handle: string) {
  return JSON.parse(await readFile(join(dirname(path), 'agent-claims', handle, 'credential.json'), 'utf8'));
}
