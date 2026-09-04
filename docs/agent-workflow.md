# Agent execution workflow

This is the canonical execution contract for routine repository work. Product
plans define what to build and architecture documents define invariants. They
do not create an additional development loop unless the user explicitly asks
to operate that process.

## Default loop

1. **Scope once.** Keep one task aligned to one branch/worktree and one pull
   request. Create a committed plan or control board only when the user asks for
   one or when unresolved multi-session decisions need a durable artifact.
2. **Test the changed boundary.** During implementation, run the smallest
   focused suite that can falsify the change. Re-run it when code or its runtime
   environment changes, not when ownership changes between people or agents.
3. **Share early.** Push the first coherent implementation commit and open a
   draft pull request. The hooks own repository policy and the fast tier; do not
   manually repeat a current hook result.
4. **Let CI fan out.** Pull-request CI owns the complete public verification
   graph for the exact head commit. A local `npm run verify:pr` is for offline
   preflight or reproducing a CI failure, not routine duplication.
5. **Handoff once.** Record the outcome, focused evidence, and the three most
   realistic failure modes in the pull request. Refer to exact-head CI instead
   of copying its logs or producing separate receipts for every role.

## Verification ownership

| Stage | Owner | Required evidence | Repeat only when |
| --- | --- | --- | --- |
| Editing | Implementer | Focused suite for the changed boundary | Relevant code or environment changed |
| Commit | Pre-commit hook | File-size and test-ownership policies | The staged tree changed |
| Push | Pre-push hook | `verify:fast` | The pushed commit changed |
| Pull request | GitHub Actions | Full public graph on the exact head | The head commit changed or a proven flaky failure needs investigation |
| Handoff | Pull-request author | Claim, three risks, concise evidence | The claim or head commit changed |

A passing result belongs to its commit, not to the person or agent who ran it.
Subsequent reviewers should inspect that evidence and run only a missing,
changed, or adversarially distinct check.

## Exceptional evidence

- Browser UX changes still require the real browser loop and installed-Chrome
  evidence described in `docs/browser-qa-loop.md`.
- Import/compiler changes still require deterministic digests, animation
  inventories, and boundary samples from `AGENTS.md`.
- Private acceptance runs require explicit authorization and the safeguards in
  `docs/acceptance-corpus.md`.

These checks extend the evidence for the affected boundary; they do not require
every participant to rerun the complete public graph.

## Execution artifacts

Do not commit generated goal boards, role queues, per-task state, command logs,
or agent transcripts. `docs/goals/` is reserved for ignored local execution
state, and repository policy rejects force-added files there. User-requested
durable plans should stay concise; product evidence and deterministic receipts
remain governed by their existing product and privacy contracts.
