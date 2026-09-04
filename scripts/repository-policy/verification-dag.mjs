import { spawn as spawnProcess } from 'node:child_process';

import { verificationSuites, verificationTiers } from './verification-manifest.mjs';

function resolveSuites(selectedSuites, suites) {
  const ordered = [];
  const resolved = new Set();
  const active = [];

  const visit = (name) => {
    if (resolved.has(name)) return;

    const cycleStart = active.indexOf(name);
    if (cycleStart !== -1) {
      const cycle = [...active.slice(cycleStart), name].join(' -> ');
      throw new Error(`Verification dependency cycle: ${cycle}`);
    }

    const suite = suites[name];
    if (!suite) throw new Error(`Unknown verification suite: ${name}`);

    active.push(name);
    for (const dependency of suite.dependsOn ?? []) visit(dependency);
    active.pop();
    resolved.add(name);
    ordered.push(name);
  };

  for (const name of selectedSuites) visit(name);
  return ordered;
}

export function resolveVerificationTier(tier, suites, tiers) {
  const selectedSuites = tiers[tier];
  if (!selectedSuites) throw new Error(`Unknown verification tier: ${tier}`);
  return resolveSuites(selectedSuites, suites);
}

export function spawnVerificationSuite(_name, suite, repositoryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(suite.command, suite.args ?? [], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function runVerification({
  repositoryRoot,
  tier,
  selectedSuites,
  definitions = { suites: verificationSuites, tiers: verificationTiers },
  now = Date.now,
  spawn = spawnVerificationSuite,
}) {
  if (!tier && !selectedSuites?.length) {
    throw new Error('Select a verification tier or at least one suite');
  }

  const selected = selectedSuites?.length
    ? resolveSuites(selectedSuites, definitions.suites)
    : resolveVerificationTier(tier, definitions.suites, definitions.tiers);
  const results = [];
  const resultsBySuite = new Map();

  for (const name of selected) {
    const suite = definitions.suites[name];
    const dependencyFailed = (suite.dependsOn ?? []).some(
      (dependency) => resultsBySuite.get(dependency)?.status !== 'passed',
    );

    if (dependencyFailed) {
      const result = { suite: name, status: 'skipped', durationMs: 0, exitCode: null };
      results.push(result);
      resultsBySuite.set(name, result);
      continue;
    }

    const startedAt = now();
    const exitCode = await spawn(name, suite, repositoryRoot);
    const result = {
      suite: name,
      status: exitCode === 0 ? 'passed' : 'failed',
      durationMs: Math.max(0, now() - startedAt),
      exitCode,
    };
    results.push(result);
    resultsBySuite.set(name, result);
  }

  return {
    schemaVersion: 'motion.verification-receipt.v1',
    passed: results.every(({ status }) => status === 'passed'),
    selected,
    results,
  };
}
