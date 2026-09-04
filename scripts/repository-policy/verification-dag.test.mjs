import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVerificationTier, runVerification } from './verification-dag.mjs';

const suite = (dependsOn = []) => ({
  kind: 'command',
  command: 'true',
  args: [],
  dependsOn,
  public: true,
  fast: true,
});

test('resolves shared dependencies once in stable topological order', () => {
  const suites = {
    base: suite(),
    left: suite(['base']),
    right: suite(['base']),
  };

  assert.deepEqual(resolveVerificationTier('fast', suites, {
    fast: ['left', 'right'],
  }), ['base', 'left', 'right']);
});

test('rejects unknown nodes before execution', () => {
  assert.throws(
    () => resolveVerificationTier('fast', { base: suite() }, { fast: ['missing'] }),
    /Unknown verification suite: missing/,
  );
});

test('rejects dependency cycles before execution', () => {
  assert.throws(
    () => resolveVerificationTier('fast', {
      first: suite(['second']),
      second: suite(['first']),
    }, { fast: ['first'] }),
    /Verification dependency cycle: first -> second -> first/,
  );
});

test('skips failed dependants while continuing independent suites', async () => {
  const executed = [];
  const receipt = await runVerification({
    repositoryRoot: '/tmp/repository',
    tier: 'pr',
    definitions: {
      suites: {
        base: suite(),
        failing: suite(['base']),
        dependant: suite(['failing']),
        independent: suite(),
      },
      tiers: { pr: ['dependant', 'independent'] },
    },
    now: () => 100,
    spawn: async (name) => {
      executed.push(name);
      return name === 'failing' ? 7 : 0;
    },
  });

  assert.deepEqual(executed, ['base', 'failing', 'independent']);
  assert.deepEqual(receipt, {
    schemaVersion: 'motion.verification-receipt.v1',
    passed: false,
    selected: ['base', 'failing', 'dependant', 'independent'],
    results: [
      { suite: 'base', status: 'passed', durationMs: 0, exitCode: 0 },
      { suite: 'failing', status: 'failed', durationMs: 0, exitCode: 7 },
      { suite: 'dependant', status: 'skipped', durationMs: 0, exitCode: null },
      { suite: 'independent', status: 'passed', durationMs: 0, exitCode: 0 },
    ],
  });
  assert.equal('startedAt' in receipt, false);
});

test('runs an explicit suite with its dependencies', async () => {
  const executed = [];
  const receipt = await runVerification({
    repositoryRoot: '/tmp/repository',
    selectedSuites: ['leaf'],
    definitions: {
      suites: { policy: suite(), leaf: suite(['policy']) },
      tiers: {},
    },
    now: () => 20,
    spawn: async (name) => {
      executed.push(name);
      return 0;
    },
  });

  assert.deepEqual(executed, ['policy', 'leaf']);
  assert.equal(receipt.passed, true);
});
