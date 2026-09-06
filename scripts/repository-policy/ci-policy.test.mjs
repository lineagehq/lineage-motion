import assert from 'node:assert/strict';
import test from 'node:test';
import { planVerification, inspectVerificationGate, verificationJobNames } from './ci-policy.mjs';

const code = ['apps/editor/src/main.ts'];
const prose = ['README.md', 'docs/animation-delivery-plan.md'];
const event = (draft, paths = code, action = 'synchronize') => ({
  eventName: 'pull_request', action, draft, paths,
});
const statuses = (mode) => Object.fromEntries(verificationJobNames.map((name) => [name,
  name === 'scope' || name === 'policy-fast'
    || (name === 'typecheck-build' && mode !== 'prose')
    || (name === 'smoke' && mode === 'smoke')
    || (['integration', 'recovery-parity', 'determinism-visual', 'browser'].includes(name) && mode === 'full')
    ? 'success' : 'skipped']));

test('draft iterations stay small; ready transition and every later head receive full proof', () => {
  for (const action of ['opened', 'reopened', 'synchronize', 'edited']) {
    assert.equal(planVerification(event(true, code, action)).mode, 'smoke');
    assert.equal(planVerification(event(false, code, action)).mode, 'full');
  }
  assert.equal(planVerification(event(false, code, 'ready_for_review')).mode, 'full');
  assert.equal(planVerification(event(true, code, 'converted_to_draft')).mode, 'smoke');
});

test('only known prose paths qualify; executable docs and instruction/config changes remain code', () => {
  assert.equal(planVerification(event(true, prose)).mode, 'prose');
  assert.equal(planVerification(event(false, prose)).mode, 'prose');
  for (const path of ['AGENTS.md', 'docs/AGENTS.md', 'docs/AGENTS.override.md',
    'docs/design-references/example/index.html', 'docs/design-references/example/verify.mjs',
    'docs/design-references/example/README.md', 'docs/evidence/receipt.json',
    'package-lock.json', '.github/workflows/verification.yml', 'fixtures/scene.html',
    'packages/new/README.md', 'new-file.md', '.husky/pre-push']) {
    assert.equal(planVerification(event(true, [path])).mode, 'smoke', path);
  }
  assert.equal(planVerification(event(true, [...prose, ...code])).mode, 'smoke');
  // Renames must supply both old and new paths; deleting code is still a code change.
  assert.equal(planVerification(event(true, ['packages/domain/src/model.ts', 'docs/model.md'])).mode, 'smoke');
});

test('unknown, malformed and empty classification evidence cannot silently reduce coverage', () => {
  for (const paths of [undefined, null, [], [''], ['../README.md'], ['/README.md'], ['docs/../README.md']]) {
    assert.throws(() => planVerification({ ...event(true), paths }), /CI_PATH_EVIDENCE_INVALID/);
  }
  assert.throws(() => planVerification({ ...event(true), draft: undefined }), /CI_PR_STATE_INVALID/);
  assert.throws(() => planVerification({ ...event(true), action: 'unknown' }), /CI_PR_EVENT_INVALID/);
  assert.throws(() => planVerification({ eventName: 'unknown' }), /CI_EVENT_UNSUPPORTED/);
});

test('nightly and explicit regression runs always select the full graph', () => {
  for (const eventName of ['schedule', 'workflow_dispatch']) {
    assert.equal(planVerification({ eventName }).mode, 'full');
  }
});

test('gate accepts only the exact selected jobs with successful planning evidence', () => {
  for (const mode of ['prose', 'smoke', 'full']) {
    const plan = { mode };
    assert.deepEqual(inspectVerificationGate(plan, statuses(mode)), { passed: true, failures: [] });
    for (const [job, result] of Object.entries(statuses(mode))) {
      for (const failure of ['failure', 'cancelled', 'timed_out', 'neutral', 'action_required', undefined]) {
        assert.equal(inspectVerificationGate(plan, { ...statuses(mode), [job]: failure }).passed, false,
          `${mode}/${job}/${failure}`);
      }
      if (result === 'success') {
        assert.equal(inspectVerificationGate(plan, { ...statuses(mode), [job]: 'skipped' }).passed, false,
          `${mode}/${job}/skipped`);
      }
    }
  }
});

test('the aggregate cannot convert missing or forged plan data into a successful result', () => {
  for (const plan of [null, {}, { mode: 'unknown' }, { mode: 'full', ignoredFailure: true }]) {
    assert.equal(inspectVerificationGate(plan, statuses('full')).passed, false);
  }
  assert.equal(inspectVerificationGate({ mode: 'full' }, {}).passed, false);
  assert.equal(inspectVerificationGate({ mode: 'full' }, { ...statuses('full'), unknown: 'success' }).passed, false);
});
