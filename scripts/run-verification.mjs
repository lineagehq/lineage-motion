#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { runVerification } from './repository-policy/verification-dag.mjs';

function parseArguments(args) {
  const parsed = { selectedSuites: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') parsed.json = true;
    else if (argument === '--tier') parsed.tier = args[++index];
    else if (argument === '--suite') parsed.selectedSuites.push(args[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function repositoryRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

try {
  const options = parseArguments(process.argv.slice(2));
  const receipt = await runVerification({
    repositoryRoot: repositoryRoot(),
    tier: options.tier,
    selectedSuites: options.selectedSuites,
  });

  if (options.json) console.log(JSON.stringify(receipt, null, 2));
  else {
    for (const result of receipt.results) {
      console.log(`${result.status.padEnd(7)} ${result.suite} (${result.durationMs}ms)`);
    }
  }
  process.exitCode = receipt.passed ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
