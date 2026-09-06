import { randomBytes, createHash } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateRead, safeDirectory } from './session-context.ts';
function fail(code: string): never { throw new Error(code); }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function ensureDirectory(path: string): void {
  try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  safeDirectory(path);
  if ((lstatSync(path).mode & 0o777) !== 0o700) fail('CLI_CLAIM_CONTEXT_INVALID');
}
export function readOptional<T>(path: string): T | undefined {
  try { return JSON.parse(privateRead(path)) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    fail('CLI_CLAIM_CONTEXT_INVALID');
  }
}
export function immutable<T>(path: string, value: T): T {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const directoryFd = openSync(join(path, '..'), 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    return readOptional<T>(path) ?? fail('CLI_CLAIM_CONTEXT_INVALID');
  } finally { rmSync(temporary, { force: true }); }
}
