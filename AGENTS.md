# Agent Notes

Use an adversarial proof standard. Before declaring work complete, state the
user-facing claim, name the top three realistic failure modes, and gather direct
evidence with tests, screenshots, traces, compiler receipts, or inspection.

Routine implementation follows the single-pass workflow in
`docs/agent-workflow.md`. Product plans and historical goal records describe
requirements and prior decisions; they do not add execution stages, repeated
test matrices, or per-role receipts unless the user explicitly activates them.

## Repository boundary

- This is a standalone experimental product, not a Lineage package or Canvas
  feature.
- Do not modify `lineagehq/lineage`, its databases, profiles, services,
  release process, or plugin from this repository.
- Treat future Lineage integration as a versioned adapter and receipt boundary.
- Keep one task aligned to one feature, branch/worktree, and pull request.

## Private corpus and data safety

- Never commit private product scenes, customer content, private campaign data,
  credentials, presigned URLs, screenshots from private products, or local
  SQLite databases.
- Private acceptance files may be inspected locally but must remain outside the
  repository.
- Commit only synthetic fixtures that reproduce technical constructs without
  private copy, branding, media, or layout.
- Before handoff, inspect the complete diff for private paths and content.

## Product invariants

1. The human editor and agent CLI must dispatch the same typed domain
   operations.
2. A local service is the sole persistent writer once persistence exists.
3. Every mutation names an expected revision and fails atomically when stale.
4. Agent writes are bounded by a document or branch claim once claims exist.
5. CSS selectors are source bindings, not stable identity.
6. Unsupported import features fail visibly and are never silently dropped.
7. Equal document revisions produce byte-identical exports and receipts.
8. Preview must render compiler output rather than a separate interpolator.
9. Browser-native HTML/CSS is the default production output.
10. The editor must keep reduced-motion behavior inspectable and intentional.

## Scope discipline

- Work in the current phase defined by `docs/incubation-plan.md`.
- Do not add persistence, branching, claims, MCP, Lineage integration, video
  export, or package publication before their phase gate is authorized.
- Prefer one complete vertical slice over generalized architecture.
- Put speculative extensions in planning documents instead of production code.

## Search and change hygiene

- Resolve the repository root with `git rev-parse --show-toplevel`.
- Keep searches within that root and use `rg` / `rg --files`.
- Do not recursively search `.git`, `node_modules`, `dist`, `build`, `coverage`,
  caches, or sibling worktrees unless the task explicitly requires it.
- Preserve unrelated changes and do not use destructive git commands.

## Verification

- Run the smallest focused suite while editing.
- Let pre-push own `npm run verify:fast` and let pull-request CI own the broad
  public graph. Do not repeat a passing command on an unchanged commit merely
  because another agent or stage is taking over.
- Use `npm run verify:pr` only for an offline preflight or to reproduce a CI
  failure locally.
- Handoff evidence is one compact claim, three risks, and links or summaries of
  focused local evidence plus exact-head CI. Do not paste complete command logs.

For import/compiler work, the minimum receipt should include:

- source and canonical-document digests;
- imported, unsupported, and missing animation inventories;
- deterministic export digest;
- visual samples immediately before and after discrete transitions;
- repeated-run stability;
- exact commands and environment used.

## Browser UX QA

When asked to QA, polish, or smooth the motion editor in a browser, follow
`docs/browser-qa-loop.md`. Use the real compiled preview and browser-created
animations. Prefer the smallest observable UX correction that improves the
canonical CSS-animation task; do not generalize the editor or add later-phase
architecture during a polish loop.
