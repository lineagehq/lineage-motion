import { execFileSync } from 'node:child_process';

const targets = [
  '.private-corpus/probe.json',
  '.motion/probe.json',
  'artifacts/probe.png',
];

let ignoredCount = 0;
for (const target of targets) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', target], {
      stdio: 'ignore',
    });
    ignoredCount += 1;
  } catch {
    // Counted in the aggregate result below.
  }
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const trackedPrivateCount = tracked.filter((path) =>
  path.startsWith('.private-corpus/')
  || path.startsWith('.motion/')
  || path.startsWith('artifacts/'),
).length;
const result = {
  schemaVersion: 'motion.private-ignore-check.v1',
  passed: ignoredCount === targets.length && trackedPrivateCount === 0,
  targetCount: targets.length,
  ignoredCount,
  trackedPrivateCount,
};

process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.passed) process.exitCode = 1;
