import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, isValidAuthoringOperationId, parseAuthoringOperation, type CueAuthoringOperation, type HistoryOperation, type TrajectoryAuthoringOperation } from '../../domain/src/index.ts';
import { MotionServiceClient, makeBranchCreateCommand, makeClaimAcquireCommand, makeClaimControlCommand,
  makeCueCommand, makeTrackCreateCommand, makeTrajectoryCommand, type ActorKind, type CommandResponse, type MotionCommand } from '../../motion-protocol/src/index.ts';

type Io = { stdout(value: string): void; stderr(value: string): void };
export async function runCli(argv: string[], io: Io = { stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value) }): Promise<number> {
  if (argv[0] === 'claim-secret') { io.stdout(`${randomBytes(32).toString('base64url')}\n`); return 0; }
  const parsed = parseArgs(argv); if (!parsed) { io.stderr('Usage: motion-cli <track-create|pose-set|waypoints-translate|moment-time-set|segment-easing-set|settled-hold-set|cue-create|cue-update|cue-delete|cue-detach|undo|redo|branch-create|claim-acquire|claim-renew|claim-release|claim-revoke> [options]\n'); return 2; }
  try {
    const client = new MotionServiceClient(parsed.service, (...args) => fetch(...args), { actor: parsed.actor,
      capability: parsed.capability, ...(parsed.claimSecret ? { claimSecret: parsed.claimSecret } : {}) });
    const response = await client.dispatch(parsed.command); io.stdout(canonicalJson(response)); return exitCode(response);
  } catch { io.stdout(canonicalJson({ ok: false, code: 'STORAGE_FAILURE' })); return 7; }
}
function exitCode(response: CommandResponse): number { if (response.ok) return 0;
  return { VALIDATION: 2, STALE_REVISION: 3, UNAUTHORIZED_CLAIM: 4, OPERATION_ID_CONFLICT: 5,
    UNSUPPORTED_VERSION: 6, STORAGE_FAILURE: 7 }[response.code]; }
function parseArgs(argv: string[]): { service: string; actor: ActorKind; capability: string; claimSecret?: string; command: MotionCommand } | null {
  const read = (name: string) => { const index = argv.lastIndexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const service = read('--service'), operationId = read('--operation-id'), documentId = read('--document-id');
  const expectedRevision = Number(read('--expected-revision')); const branchId = read('--branch-id') ?? 'main';
  const actor = (read('--actor') ?? (argv[0]?.startsWith('claim-') ? 'agent' : 'human')) as ActorKind;
  const capability = read('--capability') ?? (actor === 'human'
    ? process.env.MOTION_HUMAN_CAPABILITY : process.env.MOTION_AGENT_CAPABILITY)
    ?? (process.env.VITEST ? actor === 'human' ? 'human-editor' : 'cli-agent' : undefined);
  const claimSecret = read('--claim-secret');
  if (!service || !isValidAuthoringOperationId(operationId) || !documentId || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0 || (actor !== 'human' && actor !== 'agent') || !capability) return null;
  let command: MotionCommand;
  if (argv[0] === 'track-create') {
    const elementId = read('--element-id'); if (elementId !== 'el_a2849ff826f3e167' && elementId !== 'el_2dbee68b1ea318c8') return null;
    command = makeTrackCreateCommand({ operationId, documentId, expectedRevision, branchId, elementId });
  } else if (argv[0] === 'undo' || argv[0] === 'redo') {
    const operation: HistoryOperation = { schemaVersion: 'motion.operation.v1', kind: `motion.history.${argv[0]}`,
      operationId, documentId, expectedRevision };
    try { command = makeTrajectoryCommand(operation, branchId); } catch { return null; }
  } else if (['cue-create', 'cue-update', 'cue-delete', 'cue-detach'].includes(argv[0] ?? '')) {
    const bundlePath = read('--bundle'); if (!bundlePath) return null;
    let operation: CueAuthoringOperation; try {
      const parsedOperation = parseAuthoringOperation(JSON.parse(readFileSync(bundlePath, 'utf8')));
      if (!parsedOperation || !parsedOperation.kind.startsWith('motion.cue.')) return null;
      operation = parsedOperation as CueAuthoringOperation;
    } catch { return null; }
    if (operation.kind !== `motion.${argv[0]!.replace('-', '.')}` || operation.operationId !== operationId
      || operation.documentId !== documentId || operation.expectedRevision !== expectedRevision) return null;
    try { command = makeCueCommand(operation, branchId); } catch { return null; }
  } else if (['pose-set', 'waypoints-translate', 'moment-time-set', 'segment-easing-set', 'settled-hold-set'].includes(argv[0] ?? '')) {
    const bundlePath = read('--bundle'); if (!bundlePath) return null;
    let operation: TrajectoryAuthoringOperation; try { operation = JSON.parse(readFileSync(bundlePath, 'utf8')) as TrajectoryAuthoringOperation; } catch { return null; }
    const expectedKinds: Record<string, TrajectoryAuthoringOperation['kind']> = { 'pose-set': 'motion.transform-pose.set', 'waypoints-translate': 'motion.transform-waypoints.translate', 'moment-time-set': 'motion.keyframe-group-time.set', 'segment-easing-set': 'motion.keyframe-group-easing.set', 'settled-hold-set': 'motion.settled-hold.set' };
    if (operation.kind !== expectedKinds[argv[0]!] || operation.operationId !== operationId || operation.documentId !== documentId || operation.expectedRevision !== expectedRevision) return null;
    try { command = makeTrajectoryCommand(operation, branchId); } catch { return null; }
  } else if (argv[0] === 'branch-create') {
    const newBranchId = read('--new-branch-id'); if (!newBranchId) return null;
    command = makeBranchCreateCommand({ operationId, documentId, expectedRevision, sourceBranchId: branchId, branchId: newBranchId });
  } else if (argv[0] === 'claim-acquire') {
    const scope = read('--scope'); if ((scope !== 'document' && scope !== 'branch') || !claimSecret) return null;
    command = makeClaimAcquireCommand({ operationId, documentId, expectedRevision, branchId, scope });
  } else if (argv[0] === 'claim-renew' || argv[0] === 'claim-release' || argv[0] === 'claim-revoke') {
    const claimId = read('--claim-id'), leaseVersion = Number(read('--lease-version')); if (!claimId || !Number.isSafeInteger(leaseVersion)) return null;
    command = makeClaimControlCommand({ kind: `motion.${argv[0].replace('-', '.')}` as 'motion.claim.renew', operationId,
      documentId, branchId, expectedRevision, claimId, leaseVersion });
  } else return null;
  return { service, actor, capability, ...(claimSecret ? { claimSecret } : {}), command };
}
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli(process.argv.slice(2));
