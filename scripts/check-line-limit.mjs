#!/usr/bin/env node
import { inspectLineLimit } from './repository-policy/line-limit.mjs';

const receipt = inspectLineLimit(process.cwd());
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} else if (receipt.passed) {
  process.stdout.write(`File-size policy passed (${receipt.checkedCount} files checked).\n`);
} else {
  process.stderr.write('File-size policy failed:\n');
  for (const violation of receipt.violations) {
    process.stderr.write(`- ${violation.path}: ${violation.lines} lines (max ${violation.maxLines})\n`);
  }
}
process.exitCode = receipt.passed ? 0 : 1;
