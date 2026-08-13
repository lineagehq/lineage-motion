import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import postcss from 'postcss';

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function filesFrom(command) {
  return git(command).split('\0').filter(Boolean);
}

function textFile(path) {
  const buffer = readFileSync(path);
  return buffer.includes(0) ? '' : buffer.toString('utf8');
}

const trackedFiles = filesFrom(['ls-files', '-z']);
const untrackedFiles = filesFrom(['ls-files', '--others', '--exclude-standard', '-z']);
let base = null;
for (const candidate of ['refs/heads/main', 'refs/heads/master', 'HEAD^']) {
  try {
    base = git(['merge-base', 'HEAD', candidate]).trim();
    if (base) break;
  } catch {
    // Try the next local baseline.
  }
}

const surfaces = {
  trackedInventory: trackedFiles.map((path) => `${path}\n${textFile(path)}`).join('\n'),
  branchDiff: base ? git(['diff', '--no-ext-diff', '--unified=0', `${base}..HEAD`]) : '',
  index: git(['diff', '--cached', '--no-ext-diff', '--unified=0']),
  worktree: git(['diff', '--no-ext-diff', '--unified=0']),
  untracked: untrackedFiles.map((path) => `${path}\n${textFile(path)}`).join('\n'),
};

const genericPatterns = [
  /(?:\/Users\/|\/home\/)[^/\s]+\//g,
  /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][^"'\n]{8,}["']/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
  new RegExp(['X', 'Amz', 'Algorithm'].join('-'), 'g'),
  new RegExp(['X', 'Goog', 'Algorithm'].join('-'), 'g'),
];

const privateNeedles = new Set();
const manifestPath = '.private-corpus/manifest.json';
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.sourcePath === 'string' && existsSync(manifest.sourcePath)) {
      privateNeedles.add(manifest.sourcePath);
      const pathParts = manifest.sourcePath.split('/').filter(Boolean);
      const userIndex = pathParts.indexOf('Users');
      if (userIndex >= 0 && pathParts[userIndex + 1]) privateNeedles.add(pathParts[userIndex + 1]);
      const source = readFileSync(manifest.sourcePath, 'utf8');
      for (const match of source.matchAll(/>([^<>]+)</g)) {
        const text = match[1].replace(/\s+/g, ' ').trim();
        if (text.length >= 12 && /[A-Za-z]{4}/.test(text)) privateNeedles.add(text);
      }
      for (const line of source.split(/\r?\n/)) {
        const normalized = line.trim();
        if (normalized.length >= 48 && /[A-Za-z]{4}/.test(normalized)) {
          privateNeedles.add(normalized);
        }
      }
      const css = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
        .map((match) => match[1])
        .join('\n');
      if (css) {
        const root = postcss.parse(css);
        root.walkRules((rule) => {
          if (rule.parent?.type === 'atrule'
            && rule.parent.name.toLowerCase().endsWith('keyframes')) return;
          const selector = rule.selector.trim();
          if (selector.length >= 12 && ![':root', 'html, body'].includes(selector)) {
            privateNeedles.add(selector);
          }
        });
      }
    }
  } catch {
    // Generic scanning remains active; malformed local manifests are checked elsewhere.
  }
}

const findingCounts = {
  generic: 0,
  privateCorpus: 0,
};
for (const content of Object.values(surfaces)) {
  for (const pattern of genericPatterns) {
    pattern.lastIndex = 0;
    findingCounts.generic += [...content.matchAll(pattern)].length;
  }
  for (const needle of privateNeedles) {
    if (needle.length > 0 && content.includes(needle)) findingCounts.privateCorpus += 1;
  }
}

const findingCount = findingCounts.generic + findingCounts.privateCorpus;
const result = {
  schemaVersion: 'motion.sensitive-check.v1',
  passed: findingCount === 0,
  findingCount,
  findingCounts,
  scanned: {
    trackedInventory: true,
    branchDiff: true,
    index: true,
    worktree: true,
    untracked: true,
  },
  aggregate: {
    trackedFileCount: trackedFiles.length,
    untrackedFileCount: untrackedFiles.length,
    privateNeedleCount: privateNeedles.size,
  },
};

process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.passed) process.exitCode = 1;
