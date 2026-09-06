# Skills and agent-instruction audit

Audited 2026-09-06 against fetched `origin/main` at
`d289bfc00c59fd2b970e603b5314cc3748b7277e`, in the fresh worktree on
`codex/skills-agents-audit-20260906`. The findings below describe that audited baseline. The follow-up fixes are
recorded below; they do not authorize a new product phase.

## Applied follow-up

The user requested all identified fixes after the audit. The five repository
findings are addressed in AGENTS.md, the workflow/verification/browser guides,
the PR template, and a new [phase status index](phase-status.md). The original
incubation work package is explicitly historical. Verification ownership also
now applies consistently to the guide's test-addition instructions.

The two flagged installed skills were updated locally outside this repository:
OpenAI Docs has a shorter description and a local-audit route; Supabase requires
product context and routes to security, CLI, MCP, and schema references. Its
existing detailed security guidance is preserved verbatim. Both pass the skill
validator, and their entrypoint links resolve. Original and revised files are
saved outside the plugin cache for rollback and reapplication. App or plugin
updates may replace these installed customizations; they are not distributed
by this repository's PR.

Static scenario review covered SQLite maintenance, explicit Supabase work,
local instruction audits, product-fact questions, and final browser QA. The
instructions now distinguish these cases without relaxing privacy or phase
boundaries. This is instruction inspection, not a runtime model-selection
benchmark. Optional catalog curation was not a confirmed defect, so unrelated
skills remain available.

The remaining audit sections are historical findings and coverage at the
recorded baseline; file line numbers refer to that revision.

## Assessment and sources

The repository already avoids much of the redundant execution ceremony at issue.
Prioritize stale phase routing and contradictory verification wording; preserve
the concrete privacy, isolation, and compiler contracts.

Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862)
recommends short, precise skill descriptions, conditional reference loading,
fewer rigid recipes, proportionate verification, and explicit completion and
permission boundaries. The complete article text was read through the
[FxTwitter response](https://api.fxtwitter.com/pvncher/status/2095991462416490862)
because X returned 403. The response identifies the author, post, and linked
article. Embedded illustration text was not inspected; findings use the prose.
These are guidance principles, not measured performance results for this repo.

[Official skill documentation](https://learn.chatgpt.com/docs/build-skills)
confirms that discovery initially loads skill metadata, full instructions load
on selection, and large catalogs can cause descriptions to be shortened or
skills omitted. Actual truncation in this session was not established.

## Coverage

- Complete repository instruction inventory: one `AGENTS.md`, no nested
  `AGENTS.override.md`, and no repository-local `SKILL.md` files. Both tracked
  inventory and a hidden-file-aware, ignore-respecting filename scan agreed.
- Read `AGENTS.md`, its workflow and browser-QA references, the incubation plan,
  verification guide, and PR template. Checked relevant architecture/status
  passages and service filenames to validate phase drift.
- Reviewed the supplied session skill descriptions for routing and overlap.
  Read the bodies of `openai-docs`, `codex-review`, `goal-prep`,
  `manage-codex-workers`, and `supabase:supabase` as targeted samples.
- The installed catalog is user/plugin configuration outside this worktree.
  This is not an exhaustive audit of every installed skill body, reference,
  helper, or runtime trigger. No global skills or plugin caches were edited.
- The user-supplied Buffer/search instructions were considered separately:
  their Buffer trigger is appropriately narrow; their search guidance overlaps
  the tracked file. Neither is a reason to load Buffer for this task.

## Repository findings

### 1. High: the current-phase pointer routes to a stale stopping boundary

Evidence: `AGENTS.md:50-52` identifies the incubation plan as the current phase.
`docs/incubation-plan.md:111-123` still limits immediate work to Phase 0/read-only
Phase 1 and ends at architecture review. The current tree contains
`packages/local-service/src/sqlite-project-store.ts`, branch/claim recovery
tests, and Phase 4 architecture. The workflow's historical-plan exception
helps, but does not identify an authoritative current-phase status.

Consequence: an agent fixing an existing service or claim behavior can infer
that it must pause for authorization already granted during implementation.
The presence of implementation does not, by itself, prove every phase exit gate
passed; this audit does not declare a new current phase.

Recommendation: label the immediate work package historical and add a maintained
status record distinguishing implemented scope, accepted exit gates, and future
work. Suggested AGENTS wording: “Use the active request and accepted scope for
the change. Consult the phase status when expanding capabilities. Historical
phase plans do not block maintenance of existing behavior. New phase scope
still requires authorization.” Link the record once its status is established.

### 2. Medium: verification ownership still has a contradictory instruction

Evidence: `AGENTS.md:66-71` and `docs/agent-workflow.md:16-21` give the fast tier
to pre-push and discourage duplication. `docs/verification.md:31` independently
tells the implementer to run that tier before sharing.

Consequence: a literal reading runs the same fast suite manually and again at
push, despite the recent single-pass policy.

Recommendation: replace the latter sentence with “Pre-push runs `verify:fast`.
Run it manually only when sharing without the hook or investigating a failure;
reuse a current result.” Keep required CI and focused regression evidence.

### 3. Medium: fixed risk counts apply ceremony to every task

Evidence: `AGENTS.md:3-5,72-73`, `docs/agent-workflow.md:22-24`, and
`.github/PULL_REQUEST_TEMPLATE.md` require three risks regardless of scope.
This audit itself must comply with that rule even though it changes no behavior.

Consequence: small documentation changes invite padded risk lists and repeated
reporting. This is a process-cost inference, not an observed timing measurement.

Recommendation: require the outcome, relevant evidence, and material unresolved
risks; reserve a structured adversarial receipt for compiler/import fidelity,
revision/claim correctness, and other changes where it tests a concrete claim.
Update the template and workflow together so the count does not survive elsewhere.

### 4. Medium: browser rechecks are more rigid than the changed behavior needs

Evidence: `docs/browser-qa-loop.md:78-83` requires the complete canonical
walkthrough after every correction, even when several independent wording or
layout corrections occur in one bounded polish task.

Recommendation: reproduce each fixed interaction immediately, expand the recheck
when shared state, history, focus, or preview behavior changes, and run the full
walkthrough once on the final state. Preserve installed-Chrome evidence, reduced
motion, rejected-operation invariants, and the existing exact-worktree check.

### 5. Low: completion can be clearer without weakening review boundaries

Evidence: `docs/agent-workflow.md:16-24` usefully authorizes an early draft PR,
then describes CI and handoff, but never explicitly says to continue fixing
in-scope failures until the result is ready. The browser loop does define a
concrete stopping condition.

Recommendation: add “Continue through in-scope fixes and affected verification;
an early draft PR is not completion. Stop when the requested outcome is verified
or a concrete blocker requires user input. Reuse existing authorization.”
Keep merge, private-input, and new-phase boundaries intact. Audit-only requests
should deliver findings rather than implicitly implementing them.

## Session skill findings

| Skill or family | Evidence and assessment | Recommended action |
| --- | --- | --- |
| `supabase:supabase` | Description includes generic auth, schema, and database triggers; the root loads extensive security, CLI, and migration guidance together. Unrelated SQLite work could be misrouted if the initial Supabase qualifier is lost. | Front-load “Implement or troubleshoot Supabase-backed features”; make product context required. Route to task-specific references, preserving applicable security rules. |
| `openai-docs` | Long discovery description enumerates many topics. The body already routes conditionally, but mandatory docs-first sequencing can force external lookup into a local instruction audit. | Shorten to “Use for OpenAI product/API guidance and Codex configuration or troubleshooting.” Allow local audits to inspect the named files first; fetch docs for product-behavior claims. |
| `codex-review` | Inspected body is a small compatibility router, selects a canonical reviewer, and prevents stacking duplicate reviews. | Keep. Do not invoke it for a prose-instruction audit merely because “audit” resembles review. |
| `goal-prep` | Inspected body limits board preparation to explicit requests and distinguishes preparation from execution. | Keep; no board is needed for ordinary implementation or this audit. |
| `manage-codex-workers` and Conveyor entries | Inspected manager root conditionally routes to references; supplied child descriptions identify concrete operations. | Keep the explicit workflow scope. Catalog consolidation is optional and should depend on actual usage, not name count alone. |
| Browser, Chrome, computer-use | Supplied descriptions distinguish in-app pages, existing Chrome state, and native-app UI. | Keep those distinctions; prefer purpose-built tools where available. No body-level defect asserted. |
| Goal drafting, GoalBuddy, Conveyor | Several planning/orchestration choices are visible, but descriptions identify different requested outcomes. | Do not infer a conflict solely from overlap. Test selection with ordinary implementation, goal drafting, and explicit managed-worker prompts. |
| Games, job applications, documents, social tools | Available metadata adds discovery context; these workflows are mostly unrelated to this repository. | Consider user-level curation if unwanted selection or truncation is observed. Do not uninstall useful cross-project tools or copy their bodies into this repo. |

The strongest positive examples are already the local compatibility routers.
No new skill is needed just to wrap this repository's existing workflow docs.
Suggested trigger checks: a SQLite revision fix should not select Supabase;
an ordinary bug fix should not select GoalBuddy/Conveyor; an explicit PR review
should select one canonical review workflow. These are proposed checks, not
executed model-selection experiments.

## Verification and limits

User-facing claim: this report identifies actionable instruction friction in
the fetched repository and distinguishes it from external skill observations.

The three realistic failure modes and evidence addressing them are:

1. **Auditing stale local main:** fetched remote main and advanced only the new
   audit branch to the recorded commit before examining current instructions.
2. **Mistaking installed metadata for repo-owned skills:** compared tracked and
   hidden-file-aware inventories; explicitly scoped the external body sample.
3. **Removing necessary safeguards under the banner of simplification:** inspected
   each recommendation against privacy, isolation, phase authorization, and
   compiler/preview invariants. Instruction files remain unchanged.

Validation uses file/line inspection and review of the complete report addition.
No runtime code changed, so application, browser, compiler, and private-acceptance
suites are not evidence needed for this audit. No claim of runtime improvement,
phase acceptance, or a passed CI run is made.
