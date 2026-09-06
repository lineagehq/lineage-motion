const pullRequestActions = new Set([
  'opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited',
]);

export const verificationJobNames = [
  'scope', 'policy-fast', 'typecheck-build', 'smoke',
  'integration', 'recovery-parity', 'determinism-visual', 'browser',
];

function isProse(path) {
  if (path === 'README.md' || path === 'LICENSE') return true;
  if (!path.startsWith('docs/') || !path.endsWith('.md')) return false;
  if (path.startsWith('docs/design-references/') || path.startsWith('docs/goals/')) return false;
  return !['AGENTS.md', 'AGENTS.override.md', 'SKILL.md'].includes(path.split('/').at(-1));
}

export function planVerification({ eventName, action, draft, paths }) {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return { mode: 'full' };
  if (eventName !== 'pull_request') throw new Error('CI_EVENT_UNSUPPORTED');
  if (!pullRequestActions.has(action)) throw new Error('CI_PR_EVENT_INVALID');
  if (typeof draft !== 'boolean') throw new Error('CI_PR_STATE_INVALID');
  if (!Array.isArray(paths) || !paths.length || paths.some((path) => typeof path !== 'string'
    || !path || path.startsWith('/') || path.includes('\\')
    || path.split('/').some((part) => part === '..' || part === '.' || part === ''))) {
    throw new Error('CI_PATH_EVIDENCE_INVALID');
  }
  return { mode: paths.every(isProse) ? 'prose' : draft ? 'smoke' : 'full' };
}

export function inspectVerificationGate(plan, results) {
  if (!plan || Object.keys(plan).length !== 1 || !['prose', 'smoke', 'full'].includes(plan.mode)) {
    return { passed: false, failures: ['CI_PLAN_INVALID'] };
  }
  if (!results || Object.keys(results).length !== verificationJobNames.length
    || Object.keys(results).some((key) => !verificationJobNames.includes(key))) {
    return { passed: false, failures: ['CI_JOB_EVIDENCE_INVALID'] };
  }
  const selected = new Set(['scope', 'policy-fast']);
  if (plan.mode !== 'prose') selected.add('typecheck-build');
  if (plan.mode === 'smoke') selected.add('smoke');
  if (plan.mode === 'full') {
    for (const job of ['integration', 'recovery-parity', 'determinism-visual', 'browser']) selected.add(job);
  }
  const failures = verificationJobNames.flatMap((job) => {
    const expected = selected.has(job) ? 'success' : 'skipped';
    return results[job] === expected ? [] : [`${job}: expected ${expected}, got ${results[job] ?? 'missing'}`];
  });
  return { passed: failures.length === 0, failures };
}
