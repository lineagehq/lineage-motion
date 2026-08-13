import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function prepareStorePath(input: string): { databasePath: string; lockPath: string } {
  const databasePath = resolve(input);
  const directory = dirname(databasePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const lockPath = `${databasePath}.lock`;
  closeSync(openSync(lockPath, 'a', 0o600)); chmodSync(lockPath, 0o600);
  return { databasePath, lockPath };
}
