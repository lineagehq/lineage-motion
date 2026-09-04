import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { trackedFiles } from './tracked-files.mjs';

const CODE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);
const GITHUB_EXTENSIONS = new Set([...CODE_EXTENSIONS, '.json', '.yaml', '.yml']);

export function classifyLineLimitedPath(path) {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized === 'package-lock.json'
    || normalized.startsWith('docs/')
    || normalized.startsWith('fixtures/')
  ) {
    return 'exempt';
  }
  const extension = normalized.includes('.')
    ? normalized.slice(normalized.lastIndexOf('.'))
    : '';
  if (normalized.startsWith('apps/') || normalized.startsWith('packages/')) {
    return CODE_EXTENSIONS.has(extension) ? 'included' : 'exempt';
  }
  if (normalized.startsWith('scripts/')) {
    return CODE_EXTENSIONS.has(extension) ? 'included' : 'exempt';
  }
  if (normalized.startsWith('.github/')) {
    return GITHUB_EXTENSIONS.has(extension) ? 'included' : 'exempt';
  }
  if (!normalized.includes('/')) {
    return CODE_EXTENSIONS.has(extension) ? 'included' : 'exempt';
  }
  return 'exempt';
}

export function physicalLineCount(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.includes(0)) {
    return null;
  }
  if (buffer.length === 0) {
    return 0;
  }
  let newlines = 0;
  for (const byte of buffer) {
    if (byte === 10) {
      newlines += 1;
    }
  }
  return buffer.at(-1) === 10 ? newlines : newlines + 1;
}

export function inspectLineLimit(repositoryRoot, options = {}) {
  const maxLines = options.maxLines ?? 500;
  const violations = [];
  let checkedCount = 0;
  for (const path of trackedFiles(repositoryRoot)) {
    if (classifyLineLimitedPath(path) !== 'included') {
      continue;
    }
    const lines = physicalLineCount(readFileSync(join(repositoryRoot, path)));
    if (lines === null) {
      continue;
    }
    checkedCount += 1;
    if (lines > maxLines) {
      violations.push({ path, lines, maxLines });
    }
  }
  return {
    passed: violations.length === 0,
    checkedCount,
    violations,
  };
}
