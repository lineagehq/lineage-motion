import { execFileSync } from 'node:child_process';

import { trackedFiles } from './repository-policy/tracked-files.mjs';

const repositoryRoot = process.cwd();
const probe = 'docs/goals/local/state.yaml';
let ignored = false;
try {
  execFileSync('git', ['check-ignore', '--quiet', '--no-index', probe], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  });
  ignored = true;
} catch {
  // Reported in the aggregate result below.
}

const trackedPaths = trackedFiles(repositoryRoot).filter((path) => path.startsWith('docs/goals/'));
const result = {
  schemaVersion: 'motion.execution-artifact-check.v1',
  passed: ignored && trackedPaths.length === 0,
  ignored,
  trackedPaths,
};

process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.passed) process.exitCode = 1;
