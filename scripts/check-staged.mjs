#!/usr/bin/env node
import { checkIndex } from './repository-policy/staged-tree.mjs';
try {
  const result = await checkIndex(process.cwd());
  console.log(JSON.stringify({ schemaVersion: 'motion.staged-policy.v1', ...result }));
  process.exitCode = result.passed ? 0 : 1;
} catch {
  console.error('Staged policy could not inspect the index or its manifest. Resolve conflicts and check staged configuration.');
  process.exitCode = 1;
}
