import { execFileSync } from 'node:child_process';
import { classifyLineLimitedPath, physicalLineCount } from './line-limit.mjs';
import { validateVerificationManifest } from './verification-policy.mjs';

export function inspectIndex(root, env = process.env) {
  const git = (args, options = {}) => execFileSync('git', args, {
    cwd: root, env, maxBuffer: 128 * 1024 * 1024, ...options,
  });
  const entries = git(['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean)
    .map((entry) => {
      const [mode, oid, stage] = entry.slice(0, entry.indexOf('\t')).split(' ');
      return { mode, oid, stage, path: entry.slice(entry.indexOf('\t') + 1) };
    });
  if (entries.some(({ stage }) => stage !== '0')) throw new Error('Resolve staged conflicts first.');
  const objects = git(['cat-file', '--batch'], { input: entries.map(({ oid }) => oid).join('\n') + '\n' });
  let offset = 0;
  const violations = [];
  const blobs = new Map();
  for (const entry of entries) {
    const end = objects.indexOf(10, offset);
    const [oid, kind, size] = objects.subarray(offset, end).toString().split(' ');
    if (oid !== entry.oid || kind !== 'blob') throw new Error('Unsupported staged object.');
    const bytes = objects.subarray(end + 1, end + 1 + Number(size));
    offset = end + Number(size) + 2;
    blobs.set(entry.path, bytes);
    const reasons = [];
    if (forbiddenPath(entry.path)) reasons.push('forbidden artifact');
    if (!['100644', '100755'].includes(entry.mode)) reasons.push('unsupported file mode');
    if (bytes.length > 5 * 1024 * 1024) reasons.push('file exceeds 5 MiB');
    if (classifyLineLimitedPath(entry.path) === 'included' && physicalLineCount(bytes) > 500) {
      reasons.push('code exceeds 500 lines');
    }
    if (sensitive(entry.path) || (!bytes.includes(0) && sensitive(bytes.toString()))) {
      reasons.push('sensitive content');
    }
    // Never print paths or snippets: either can contain private data.
    if (reasons.length) violations.push({ stagedEntry: blobs.size, reasons });
  }
  return { blobs, violations };
}

export function forbiddenPath(path) {
  return /(^|\/)(?:\.private-corpus|\.motion|\.worktrees|node_modules|artifacts|screenshots|test-results|playwright-report|dist|build|coverage|\.cache)(?:\/|$)/.test(path)
    || path.startsWith('docs/goals/')
    || /(?:\.sqlite(?:-(?:shm|wal))?|\.db|\.pem|\.key|\.log)$/i.test(path)
    || /(^|\/)\.env(?:\..*)?$/.test(path) && !path.endsWith('.env.example');
}

export function sensitive(text) {
  return [
    /(?:\/Users\/|\/home\/)[^/\s]+\//,
    /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][^"'\n]{8,}["']/i,
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----/,
    new RegExp(['X', 'Amz', 'Algorithm'].join('-')),
    new RegExp(['X', 'Goog', 'Algorithm'].join('-')),
  ].some((pattern) => pattern.test(text));
}

export async function checkIndex(root, env) {
  const { blobs, violations } = inspectIndex(root, env);
  const manifestPath = 'scripts/repository-policy/verification-manifest.mjs';
  const manifestBytes = blobs.get(manifestPath);
  if (!manifestBytes) throw new Error('Stage the verification manifest.');
  const { verificationSuites, verificationTiers } = await import(
    `data:text/javascript;base64,${manifestBytes.toString('base64')}`
  );
  const policy = validateVerificationManifest(root, verificationSuites, verificationTiers,
    [...blobs.keys()].filter((path) => /(?:\.test|\.spec)\.(?:ts|tsx|js|mjs)$/.test(path)));
  const missingFiles = Object.values(verificationSuites).flatMap((suite) => suite.files ?? [])
    .some((path) => !blobs.has(path));
  if (!policy.passed || missingFiles) violations.push({ reasons: ['staged manifest ownership or tier inconsistency'] });
  return { passed: violations.length === 0, checkedCount: blobs.size, violations };
}
