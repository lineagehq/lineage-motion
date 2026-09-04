#!/usr/bin/env node
import { verificationSuites, verificationTiers } from './repository-policy/verification-manifest.mjs';
import { validateVerificationManifest } from './repository-policy/verification-policy.mjs';

const receipt = validateVerificationManifest(process.cwd(), verificationSuites, verificationTiers);
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} else if (receipt.passed) {
  process.stdout.write('Verification manifest passed: every tracked test has one owner.\n');
} else {
  process.stderr.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
process.exitCode = receipt.passed ? 0 : 1;
