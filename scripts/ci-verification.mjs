import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { currentPullRequest } from './repository-policy/ci-pr-state.mjs';
import { planVerification, inspectVerificationGate } from './repository-policy/ci-policy.mjs';

async function resolvePlan() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  let request = { eventName };
  if (eventName === 'pull_request') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const head = event.pull_request?.head?.sha;
    if (typeof head !== 'string' || !/^[a-f0-9]{40}$/.test(head)) {
      throw new Error('CI_COMMIT_IDENTITY_INVALID');
    }
    const current = await currentPullRequest(event);
    const base = current.base.sha;
    const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (git(['rev-parse', 'HEAD']).trim() !== head) throw new Error('CI_CHECKOUT_IDENTITY_MISMATCH');
    const mergeBase = git(['merge-base', base, head]).trim();
    const paths = git(['diff', '--name-only', '--no-renames', '-z', mergeBase, head]).split('\0').filter(Boolean);
    request = { eventName, action: event.action, draft: current.draft, paths };
  }
  return planVerification(request);
}

async function plan() {
  const result = await resolvePlan();
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function gate() {
  const currentPlan = await resolvePlan();
  if (currentPlan.mode !== process.env.CI_PLAN_MODE) throw new Error('CI_PR_PLAN_CHANGED');
  const needs = JSON.parse(process.env.CI_JOB_RESULTS ?? '{}');
  const results = Object.fromEntries(Object.entries(needs).map(([name, value]) => [name, value?.result]));
  const result = inspectVerificationGate({ mode: process.env.CI_PLAN_MODE }, results);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

try {
  if (process.argv[2] === 'plan') await plan();
  else if (process.argv[2] === 'gate') await gate();
  else throw new Error('CI_COMMAND_INVALID');
} catch (error) {
  // Event paths and job payloads can contain private source data; never echo them.
  const code = error instanceof Error && /^CI_[A-Z_]+$/.test(error.message)
    ? error.message : 'CI_EVIDENCE_UNAVAILABLE';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
