export const sequenceViewportGuidance = 'Shots must match the sequence viewport in exact width AND height (CSS pixels); equal aspect ratio is insufficient. Run npm run motion -- sequences to discover sequence IDs, npm run motion -- sequence --sequence-id ID to inspect the target viewport/revision, and npm run motion -- sequence-sources to inspect source IDs/revisions/viewports in the same project. Choose a supported source with both dimensions matching, or explicitly create a separate sequence matching the source using sequence-create --help. No resizing is performed.';
export const sequenceViewportRecovery = 'SEQUENCE_VIEWPORT_MISMATCH: ' + sequenceViewportGuidance + ' The rejected edit leaves the sequence unchanged. A corrected request needs a new operation ID; keep the explicit target, expected revision and claim unless separately reconciled. Retry an uncertain request only with its original arguments, operation ID, revision and handle. See npm run motion -- sequence-clip-add --help and docs/agent-sequence-guide.md.';
const context = ['--project NAME', '--data-dir DIRECTORY', '--sequence-id ID'];
const mutation = ['--operation-id ID', '--expected-revision N', '--claim HANDLE (managed session)'];
export const sequenceOptions: Record<string, string[]> = {
  sequences: [], 'sequence-sources': [], sequence: [],
  'sequence-create': ['--sequence-id ID', '--name NAME', '--viewport-width PX', '--viewport-height PX'],
  'sequence-rename': ['--name NAME'],
  'sequence-clip-add': ['--clip-id ID', '--name NAME', '--index N', '--source-document-id ID', '--source-revision N'],
  'sequence-clip-duplicate': ['--clip-id ID', '--new-clip-id ID', '--name NAME'],
  'sequence-clip-remove': ['--clip-id ID'], 'sequence-clip-move': ['--clip-id ID', '--index N'],
  'sequence-clip-rename': ['--clip-id ID', '--name NAME'], 'sequence-clip-hold': ['--clip-id ID', '--end-hold-seconds N'],
  'sequence-clip-update-source': ['--clip-id ID', '--source-document-id ID', '--source-revision N'],
  'sequence-undo': [], 'sequence-redo': [], 'sequence-claim-acquire': [],
  'sequence-claim-renew': ['--lease-version N'], 'sequence-claim-release': ['--lease-version N'],
  'sequence-claim-revoke': ['--claim-id ID', '--lease-version N (explicit human transport only)'],
  'sequence-export': ['--expected-revision N', '--output FILE.zip'],
};
export const sequenceReadNames = ['sequences', 'sequence-sources', 'sequence', 'sequence-export'];
export function sequenceDetail(name: string): unknown | null {
  if (!Object.hasOwn(sequenceOptions, name)) return null;
  const read = sequenceReadNames.includes(name);
  return { schemaVersion: 'motion.cli-command.v1', name, category: read ? 'read' : 'mutation',
    contextOptions: context, requiredOptions: [...sequenceOptions[name]!, ...read ? [] : mutation],
    ...(name === 'sequence-create' ? { optionalOptions: ['--clip-id ID --clip-name NAME --source-document-id ID --source-revision N (all together)', '--end-hold-seconds N (initial clip only)'] } : {}),
    ...(['sequence-claim-renew', 'sequence-claim-release'].includes(name) ? { explicitTransportOptions: ['--claim-id ID', '--claim-secret SECRET'] } : {}),
    ...(name === 'sequence-clip-add' ? { optionalOptions: ['--end-hold-seconds N (default 0)'] } : {}),
    selection: 'An omitted sequence ID is accepted only when exactly one exists. Creation always requires an explicit new ID.',
    sourcePins: 'Read sequence-sources; supply the exact source document ID and its expected revision. Unsupported sources include a reason. Source changes require explicit update-source.',
    viewport: sequenceViewportGuidance,
    viewportMismatch: sequenceViewportRecovery,
    recovery: 'Retry the identical normalized arguments, operation ID, revision and handle. Resolved pins and claim secrets remain in private immutable local records.',
    units: 'Seconds must convert exactly to integer milliseconds; --end-hold-ms is also accepted, never together.',
    output: name === 'sequence-export' ? 'Committed standalone ZIP; stdout includes receipt and archive digest, never HTML/CSS, credentials or output paths.' : 'Validated canonical service projection or operation receipt.',
    guide: 'docs/agent-sequence-guide.md' };
}
