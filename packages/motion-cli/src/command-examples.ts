/** Placeholders are filled from project/workspace/claim responses, never guessed source IDs. */
export const workflowExamples = {
  projects: ['projects'], context: ['context'], project: ['project'], workspace: ['workspace', '--document-id', '{documentId}'],
  admit: ['shot-admit', '--project-id', '{projectId}', '--expected-catalog-revision', '{catalogRevision}',
    '--document-id', 'agent_intro', '--name', 'Intro', '--starter', 'trajectory', '--claim', 'intro', '--operation-id', 'admit-intro'],
  acquire: ['claim-acquire', '--document-id', '{documentId}', '--claim', 'edit', '--scope', 'document',
    '--expected-revision', '{revision}', '--operation-id', 'acquire-edit'],
  create: ['track-create', '--document-id', '{documentId}', '--claim', 'edit', '--element-id', '{elementId}',
    '--expected-revision', '{revision}', '--operation-id', 'create-motion', '--validate-only'],
  edit: ['track-create', '--document-id', '{documentId}', '--claim', 'edit', '--element-id', '{elementId}',
    '--expected-revision', '{revision}', '--operation-id', 'create-motion'],
  renew: ['claim-renew', '--document-id', '{documentId}', '--claim', 'edit', '--expected-revision', '{revision}',
    '--operation-id', 'renew-edit', '--lease-version', '{leaseVersion}'],
  release: ['claim-release', '--document-id', '{documentId}', '--claim', 'edit', '--expected-revision', '{revision}',
    '--operation-id', 'release-edit', '--lease-version', '{leaseVersion}'],
} as const;
export const recoveryHelp = {
  CLI_PROJECT_AMBIGUOUS: 'Run projects; repeat with --project NAME. Projects are scoped to this checkout.',
  CLI_SHOT_AMBIGUOUS: 'Run shots; select an exact documentId using --document-id. Duplicate labels are allowed.',
  CLI_SESSION_NOT_FOUND: 'Start npm run dev:editor in this checkout with the same --project and --data-dir.',
  CLI_SESSION_CHANGED: 'The app restarted or this is a different session. Inspect workspace and claims; old handles cannot authorize it.',
  CLI_CLAIM_PENDING: 'Retry the original command that created this handle: shot-admit for admission, or claim-acquire for acquisition. Keep every original input unchanged, including source, handle, operation ID, scope and expected revision.',
  CLI_CLAIM_INACTIVE: 'This handle was released. Inspect current workspace and claims before explicitly acquiring a new handle.',
  CLI_CLAIM_HANDLE_USED: 'For recovery, repeat the exact original shot-admit or claim-acquire that created this handle. Choose a new handle only for a new admission or acquisition.',
  CLI_CLAIM_REQUEST_CONFLICT: 'An operation ID is bound to its original revision and lease version. Retry it exactly.',
  CLI_SERVICE_FAILURE: 'The service is unavailable or returned invalid evidence. Retry the identical request after restoring it.',
  STALE_REVISION: 'Inspect current workspace and preserve the rejected draft. Submit a new explicit operation only after reconciling it.',
  UNAUTHORIZED_CLAIM: 'Inspect claims. Expired or revoked claims are not silently renewed or replaced; an overlapping claim must be explicitly released or expire before a new acquisition.',
} as const;
