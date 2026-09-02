import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { MotionServiceClient, commandSchema, makeBranchCreateCommand, makeClaimAcquireCommand,
  makeClaimControlCommand, makeOperationIntentCommand, makeTrackCreateCommand, MotionPreparationError,
  parseCommandDetailed, type ActorKind, type CommandFailure, type CommandResponse,
  type MotionCommand } from '../../motion-protocol/src/index.ts';

type Io = { stdout(value: string): void; stderr(value: string): void };
class IneligiblePreparation extends Error { constructor(readonly preparation: unknown) { super('CLI_PREPARATION_INELIGIBLE'); } }
class CommandInputError extends Error { constructor(readonly response: CommandFailure) { super(response.diagnostic.code); } }

const operationKinds = [
  'motion.track.create', 'motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.keyframe.add',
  'motion.keyframe.remove', 'motion.slot-duration.set', 'motion.binding-delay.set', 'motion.slot-easing.set',
  'motion.hold.insert', 'motion.transform-pose.set', 'motion.transform-waypoints.translate',
  'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
  'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
  'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
  'motion.history.undo', 'motion.history.redo', 'motion.branch.create', 'motion.claim.acquire',
  'motion.claim.renew', 'motion.claim.release', 'motion.claim.revoke',
] as const;

const mutationNames: Record<string, (typeof operationKinds)[number]> = {
  'track-create': 'motion.track.create', 'keyframe-value-set': 'motion.keyframe-value.set',
  'keyframe-time-set': 'motion.keyframe-time.set', 'keyframe-add': 'motion.keyframe.add',
  'keyframe-remove': 'motion.keyframe.remove', 'slot-duration-set': 'motion.slot-duration.set',
  'binding-delay-set': 'motion.binding-delay.set', 'slot-easing-set': 'motion.slot-easing.set',
  'hold-insert': 'motion.hold.insert', 'pose-set': 'motion.transform-pose.set',
  'waypoints-translate': 'motion.transform-waypoints.translate', 'moment-time-set': 'motion.keyframe-group-time.set',
  'waypoint-add': 'motion.transform-waypoint.add', 'waypoint-remove': 'motion.transform-waypoint.remove',
  'segment-easing-set': 'motion.keyframe-group-easing.set', 'settled-hold-set': 'motion.settled-hold.set',
  'cue-create': 'motion.cue.create', 'cue-update': 'motion.cue.update', 'cue-delete': 'motion.cue.delete',
  'cue-detach': 'motion.cue.detach', undo: 'motion.history.undo', redo: 'motion.history.redo',
  'branch-create': 'motion.branch.create', 'claim-acquire': 'motion.claim.acquire',
  'claim-renew': 'motion.claim.renew', 'claim-release': 'motion.claim.release', 'claim-revoke': 'motion.claim.revoke',
};

const readNames = ['workspace', 'head', 'branches', 'claims', 'activity', 'history', 'export-proof'] as const;
const baseOptions = ['--service', '--capability', '--document-id', '--branch-id'] as const;
const commandDiscovery = {
  schemaVersion: 'motion.cli-command-list.v1',
  reads: readNames.map((name) => ({ name, requiredOptions: baseOptions })),
  utilities: [
    { name: 'operation-kinds', requiredOptions: [] },
    { name: 'validate', requiredOptions: [...baseOptions, '--command-file'] },
    { name: 'dispatch', requiredOptions: [...baseOptions, '--command-file'] },
    { name: 'claim-secret', requiredOptions: [] },
  ],
  mutations: Object.entries(mutationNames).map(([name, kind]) => ({ name, kind,
    requiredOptions: mutationRequiredOptions(kind),
    construction: 'service-discovery-and-options',
  })),
} as const;

export async function runCli(argv: string[], io: Io = {
  stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value),
}): Promise<number> {
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    io.stdout(canonicalJson(commandDiscovery)); return 0;
  }
  if (argv[1] === '--help') {
    const detail = commandDetail(argv[0]!);
    if (!detail) return writeLocalFailure(io, 'CLI_COMMAND_UNKNOWN');
    io.stdout(canonicalJson(detail)); return 0;
  }
  if (argv[0] === 'claim-secret') { io.stdout(`${randomBytes(32).toString('base64url')}\n`); return 0; }
  if (argv[0] === 'operation-kinds') {
    io.stdout(canonicalJson({ schemaVersion: 'motion.operation-kind-list.v1', operations: operationKinds })); return 0;
  }
  const options = parseOptions(argv); if (!options) return writeLocalFailure(io, 'CLI_OPTIONS_INVALID');
  try {
    const client = new MotionServiceClient(options.service, (...args) => fetch(...args), {
      actor: options.actor, capability: options.capability, ...(options.claimSecret ? { claimSecret: options.claimSecret } : {}),
    });
    const read = await runRead(argv[0]!, options, client);
    if (read !== undefined) { io.stdout(canonicalJson(read)); return 0; }
    let command: MotionCommand;
    if (argv[0] === 'dispatch') command = readCommandFile(options.commandFile);
    else if (argv[0] === 'validate') {
      command = readCommandFile(options.commandFile); const response = await client.validate(command, options.claimSecret);
      io.stdout(canonicalJson(response)); return response.valid ? 0 : exitCode(response.response as CommandResponse);
    } else command = await buildCommand(argv[0]!, options, client);
    if ((options.has('--validate') || options.has('--validate-only')) && command.command.schemaVersion === 'motion.operation-intent.v1') {
      const validation = await client.validate(command, options.claimSecret);
      if (!validation.valid || options.has('--validate-only')) {
        io.stdout(canonicalJson(validation)); return validation.valid ? 0 : exitCode(validation.response as CommandResponse);
      }
    }
    const response = await client.dispatch(command, options.claimSecret); io.stdout(canonicalJson(response)); return exitCode(response);
  } catch (error) {
    if (error instanceof MotionPreparationError) {
      io.stdout(canonicalJson(error.response)); return exitCode(error.response);
    }
    if (error instanceof IneligiblePreparation) { io.stdout(canonicalJson(error.preparation)); return 2; }
    if (error instanceof CommandInputError) { io.stdout(canonicalJson(error.response)); return exitCode(error.response); }
    if (error instanceof Error && error.message.startsWith('CLI_')) return writeLocalFailure(io, error.message);
    io.stdout(canonicalJson({ ok: false, code: 'STORAGE_FAILURE', diagnostic: {
      schemaVersion: 'motion.diagnostic.v1', code: 'CLI_SERVICE_FAILURE', category: 'storage', retryable: true,
    } })); return 7;
  }
}

function isPreparableOperation(kind: (typeof operationKinds)[number]): boolean {
  return ['motion.transform-pose.set', 'motion.transform-waypoints.translate', 'motion.transform-waypoint.add',
    'motion.transform-waypoint.remove', 'motion.keyframe-group-time.set',
    'motion.keyframe-group-easing.set', 'motion.settled-hold.set', 'motion.cue.create', 'motion.cue.update',
    'motion.cue.delete', 'motion.cue.detach'].includes(kind);
}

function mutationRequiredOptions(kind: (typeof operationKinds)[number]): string[] {
  const common = [...baseOptions, '--operation-id', '--expected-revision'];
  if (kind === 'motion.transform-pose.set') return [...common, '--element-id', '--moment-ms', '--translate-x-microunits',
    '--translate-y-microunits', '--scale-ppm', '--rotate-microdegrees', '--viewport-width', '--viewport-height'];
  if (kind === 'motion.transform-waypoints.translate') return [...common, '--element-id (repeatable)', '--moment-ms',
    '--delta-x-ppm', '--delta-y-ppm', '--viewport-width', '--viewport-height'];
  if (kind === 'motion.transform-waypoint.add' || kind === 'motion.transform-waypoint.remove') {
    return [...common, '--element-id (repeatable)', '--time-ms'];
  }
  if (kind === 'motion.keyframe-group-time.set') return [...common, '--element-id (repeatable)', '--source-time-ms',
    '--target-time-ms', '--landing-time-ms', '--settled-time-ms'];
  if (kind === 'motion.keyframe-group-easing.set') return [...common, '--element-id (repeatable)', '--moment-ms',
    '--expected-easing', '--easing'];
  if (kind === 'motion.settled-hold.set') return [...common, '--element-id (repeatable)', '--source-time-ms',
    '--settled-time-ms', '--landing-time-ms', '--boundary-time-ms=2100'];
  if (kind === 'motion.cue.create') return [...common, '--creation-key', '--semantic', 'semantic options'];
  if (kind === 'motion.cue.update') return [...common, '--cue-id', '--semantic', 'semantic options'];
  if (kind === 'motion.cue.delete' || kind === 'motion.cue.detach') return [...common, '--cue-id'];
  if (kind === 'motion.branch.create') return [...common, '--new-branch-id'];
  if (kind === 'motion.claim.acquire') return [...common, '--scope', '--claim-secret'];
  if (kind === 'motion.claim.renew' || kind === 'motion.claim.release')
    return [...common, '--claim-id', '--lease-version', '--claim-secret'];
  if (kind === 'motion.claim.revoke') return [...common, '--claim-id', '--lease-version'];
  if (kind === 'motion.track.create') return [...common, '--element-id'];
  if (kind === 'motion.keyframe-value.set') return [...common, '--track-id', '--keyframe-id', '--value'];
  if (kind === 'motion.keyframe-time.set') return [...common, '--track-id', '--keyframe-id', '--time-ms'];
  if (kind === 'motion.keyframe.add') return [...common, '--track-id', '--time-ms', '--value'];
  if (kind === 'motion.keyframe.remove') return [...common, '--track-id', '--keyframe-id'];
  if (kind === 'motion.slot-duration.set') return [...common, '--track-id', '--duration-ms'];
  if (kind === 'motion.binding-delay.set') return [...common, '--track-id', '--delay-ms'];
  if (kind === 'motion.slot-easing.set') return [...common, '--track-id', '--easing'];
  return common;
}

function commandDetail(name: string): unknown | null {
  if ((readNames as readonly string[]).includes(name)) return {
    schemaVersion: 'motion.cli-command.v1', name, category: 'read', requiredOptions: baseOptions,
    output: name === 'head' || name === 'history' ? 'motion.workspace-projection.v1' : `motion.${name}-projection.v1`,
  };
  if (name === 'operation-kinds') return { schemaVersion: 'motion.cli-command.v1', name,
    category: 'utility', requiredOptions: [], output: 'motion.operation-kind-list.v1' };
  if (name === 'validate' || name === 'dispatch') return { schemaVersion: 'motion.cli-command.v1', name,
    category: 'utility', requiredOptions: [...baseOptions, '--command-file'], input: 'motion.protocol.v1 command file' };
  const kind = mutationNames[name]; if (!kind) return null;
  return { schemaVersion: 'motion.cli-command.v1', name, kind, category: 'mutation',
    requiredOptions: mutationRequiredOptions(kind),
    construction: 'service-discovery-and-options', stableIdsFrom: ['workspace', 'claims'],
    ...(isPreparableOperation(kind) ? { preparation: 'MotionServiceClient.prepareOperation',
      dispatch: 'motion.operation-intent.v1', optionalOptions: ['--validate', '--validate-only'],
      valueFormats: { easing: 'keyword:<value> | steps:<count>:<position> | cubic-bezier:<x1>:<y1>:<x2>:<y2>',
        reveal: '--semantic reveal --target-id <id> (repeatable) --start-ms <n> --complete-ms <n>',
        cursorPath: '--semantic cursor-path --cursor-target-id <id> --start-ms <n> --arrive-ms <n> --easing <format> --waypoint <time:xPpm:yPpm> (repeatable)',
        click: '--semantic click --cursor-target-id <id> --pulse-target-id <id> --arrive-ms <n> --press-ms <n> --release-ms <n> --pulse-end-ms <n> --press-scale-ppm <n> --pulse-radius-ppm <n> --pulse-opacity-ppm <n> [--reveal-cue-id <id>]',
      } } : {}),
  };
}

function writeLocalFailure(io: Io, code: string): number {
  const fieldPath = code === 'CLI_COMMAND_UNKNOWN' ? 'command' : code.includes('REVISION') ? 'expectedRevision'
    : code.includes('ELEMENT') ? 'elementId' : code.includes('TRACK') ? 'trackId'
      : code.includes('KEYFRAME') ? 'keyframeId' : code.includes('SCOPE') ? 'scope' : undefined;
  io.stdout(canonicalJson({ ok: false, code: 'VALIDATION', diagnostic: {
    schemaVersion: 'motion.diagnostic.v1', code, category: code.includes('DISCOVERED') || code.includes('NOT_DISCOVERED')
      ? 'target' : 'protocol', retryable: false, ...(fieldPath ? { fieldPath } : {}),
  } }));
  return 2;
}

type Options = {
  service: string; actor: ActorKind; capability: string; documentId: string | undefined; branchId: string;
  operationId: string | undefined; expectedRevision: number | undefined; claimSecret: string | undefined;
  commandFile: string | undefined;
  read(name: string): string | undefined; readAll(name: string): string[]; has(name: string): boolean;
};

function parseOptions(argv: string[]): Options | null {
  const read = (name: string) => { const index = argv.lastIndexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const readAll = (name: string) => argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]!] : []);
  const has = (name: string) => argv.includes(name);
  const service = read('--service'); const actor = (read('--actor') ?? (argv[0]?.startsWith('claim-') ? 'agent' : 'human')) as ActorKind;
  const capability = read('--capability') ?? (actor === 'human' ? process.env.MOTION_HUMAN_CAPABILITY : process.env.MOTION_AGENT_CAPABILITY)
    ?? (process.env.VITEST ? actor === 'human' ? 'human-editor' : 'cli-agent' : undefined);
  if (!service || !capability || (actor !== 'human' && actor !== 'agent')) return null;
  const rawRevision = read('--expected-revision'); const expectedRevision = rawRevision === undefined ? undefined : Number(rawRevision);
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) return null;
  return { service, actor, capability, documentId: read('--document-id'), branchId: read('--branch-id') ?? 'main',
    operationId: read('--operation-id'), expectedRevision, claimSecret: read('--claim-secret'),
    commandFile: read('--command-file'), read, readAll, has };
}

async function runRead(name: string, options: Options, client: MotionServiceClient): Promise<unknown | undefined> {
  if (!['workspace', 'head', 'branches', 'claims', 'activity', 'history', 'export-proof'].includes(name)) return undefined;
  const documentId = requireText(options.documentId);
  if (name === 'workspace' || name === 'head' || name === 'history') return client.workspace(documentId, options.branchId);
  if (name === 'branches') return client.branches(documentId);
  if (name === 'claims') return client.activeClaims(documentId);
  if (name === 'activity') return client.activity(documentId, integerOption(options.read('--after'), 0), integerOption(options.read('--limit'), 100));
  return client.exportProof(documentId, options.branchId);
}

async function buildCommand(name: string, options: Options, client: MotionServiceClient): Promise<MotionCommand> {
  const kind = mutationNames[name]; if (!kind) throw new Error('CLI_COMMAND_UNKNOWN');
  const documentId = requireText(options.documentId); const operationId = requireText(options.operationId);
  const expectedRevision = requireRevision(options.expectedRevision);
  if (kind === 'motion.branch.create') return makeBranchCreateCommand({ operationId, documentId,
    expectedRevision, sourceBranchId: options.branchId, branchId: requireText(options.read('--new-branch-id')) });
  if (kind === 'motion.claim.acquire') return makeClaimAcquireCommand({ operationId, documentId, expectedRevision,
    branchId: options.branchId, scope: requireScope(options.read('--scope')) });
  if (kind === 'motion.claim.renew' || kind === 'motion.claim.release' || kind === 'motion.claim.revoke') {
    return makeClaimControlCommand({ kind, operationId, documentId, expectedRevision, branchId: options.branchId,
      claimId: requireText(options.read('--claim-id')), leaseVersion: positiveInteger(options.read('--lease-version')) });
  }
  if (isPreparableOperation(kind)) return prepareIntentCommand(kind, operationId, documentId, expectedRevision, options, client);
  if (kind === 'motion.history.undo' || kind === 'motion.history.redo') return envelopeOperation({
    schemaVersion: 'motion.operation.v1', kind, operationId, documentId, expectedRevision,
  }, options.branchId, kind, operationId, documentId, expectedRevision);
  const workspace = await client.workspace(documentId, options.branchId);
  if (workspace.revision !== expectedRevision) throw new Error('CLI_DISCOVERED_REVISION_MISMATCH');
  if (kind === 'motion.track.create') {
    const elementId = requireText(options.read('--element-id'));
    if (!workspace.elements.some((element) => element.elementId === elementId)) throw new Error('CLI_ELEMENT_NOT_DISCOVERED');
    return makeTrackCreateCommand({ operationId, documentId, expectedRevision, branchId: options.branchId,
      elementId: elementId as 'el_a2849ff826f3e167' | 'el_2dbee68b1ea318c8' });
  }
  if (kind === 'motion.hold.insert') {
    if (!workspace.cues.some((cue) => cue.cueId === 'cue_pair')) throw new Error('CLI_CUE_NOT_DISCOVERED');
    return envelopeOperation({ schemaVersion: 'motion.operation.v1', kind, operationId, documentId, expectedRevision,
      payload: { cueId: 'cue_pair', durationMs: 600 } }, options.branchId, kind, operationId, documentId, expectedRevision);
  }
  const trackId = requireText(options.read('--track-id')); const track = workspace.tracks.find((item) => item.trackId === trackId);
  if (!track) throw new Error('CLI_TRACK_NOT_DISCOVERED');
  const common = { schemaVersion: 'motion.operation.v1', kind, operationId, documentId, expectedRevision,
    elementId: track.elementId, trackId };
  let operation: unknown;
  if (kind === 'motion.keyframe-value.set' || kind === 'motion.keyframe-time.set' || kind === 'motion.keyframe.remove') {
    const keyframeId = requireText(options.read('--keyframe-id'));
    const discovered = workspace.rules.find((rule) => rule.ruleId === track.ruleId)?.tracks
      .find((ruleTrack) => ruleTrack.property === track.property)?.keyframes.some((frame) => frame.keyframeId === keyframeId);
    if (!discovered) throw new Error('CLI_KEYFRAME_NOT_DISCOVERED');
    operation = kind === 'motion.keyframe.remove' ? { ...common, keyframeId } : { ...common, keyframeId,
      payload: kind === 'motion.keyframe-value.set' ? { value: finiteNumber(options.read('--value')) }
        : { timeMs: nonnegativeInteger(options.read('--time-ms')) } };
  } else if (kind === 'motion.keyframe.add') operation = { ...common,
    payload: { timeMs: nonnegativeInteger(options.read('--time-ms')), value: finiteNumber(options.read('--value')) } };
  else if (kind === 'motion.slot-duration.set') operation = { ...common,
    payload: { durationMs: nonnegativeInteger(options.read('--duration-ms')) } };
  else if (kind === 'motion.binding-delay.set') operation = { ...common,
    payload: { delayMs: safeInteger(options.read('--delay-ms')) } };
  else if (kind === 'motion.slot-easing.set') operation = { ...common, payload: { easing: options.read('--easing') } };
  else throw new Error('CLI_COMMAND_UNKNOWN');
  return envelopeOperation(operation, options.branchId, kind, operationId, documentId, expectedRevision);
}

async function prepareIntentCommand(kind: (typeof operationKinds)[number], operationId: string, documentId: string,
  expectedRevision: number, options: Options, client: MotionServiceClient): Promise<MotionCommand> {
  const elementIds = options.readAll('--element-id');
  let intent: Record<string, unknown>;
  if (kind === 'motion.transform-pose.set') intent = { kind, elementId: one(elementIds, '--element-id'),
    momentMs: nonnegativeInteger(options.read('--moment-ms')), pose: {
      translateXMicrounits: safeInteger(options.read('--translate-x-microunits')),
      translateYMicrounits: safeInteger(options.read('--translate-y-microunits')),
      scalePpm: positiveInteger(options.read('--scale-ppm')),
      rotateMicrodegrees: safeInteger(options.read('--rotate-microdegrees')),
    }, viewport: viewport(options) };
  else if (kind === 'motion.transform-waypoints.translate') intent = { kind,
    elementIds: many(elementIds, '--element-id'), momentMs: nonnegativeInteger(options.read('--moment-ms')),
    deltaXPpm: safeInteger(options.read('--delta-x-ppm')), deltaYPpm: safeInteger(options.read('--delta-y-ppm')),
    viewport: viewport(options) };
  else if (kind === 'motion.transform-waypoint.add' || kind === 'motion.transform-waypoint.remove') intent = { kind,
    elementIds: many(elementIds, '--element-id'), timeMs: nonnegativeInteger(options.read('--time-ms')) };
  else if (kind === 'motion.keyframe-group-time.set') intent = { kind, elementIds: many(elementIds, '--element-id'),
    sourceTimeMs: nonnegativeInteger(options.read('--source-time-ms')),
    targetTimeMs: nonnegativeInteger(options.read('--target-time-ms')),
    landingTimeMs: nonnegativeInteger(options.read('--landing-time-ms')),
    settledTimeMs: nonnegativeInteger(options.read('--settled-time-ms')) };
  else if (kind === 'motion.keyframe-group-easing.set') intent = { kind, elementIds: many(elementIds, '--element-id'),
    momentMs: nonnegativeInteger(options.read('--moment-ms')), expectedEasing: parseEasing(options.read('--expected-easing')),
    easing: parseEasing(options.read('--easing')) };
  else if (kind === 'motion.settled-hold.set') intent = { kind, elementIds: many(elementIds, '--element-id'),
    sourceTimeMs: nonnegativeInteger(options.read('--source-time-ms')),
    settledTimeMs: nonnegativeInteger(options.read('--settled-time-ms')),
    landingTimeMs: nonnegativeInteger(options.read('--landing-time-ms')),
    boundaryTimeMs: literal2100(options.read('--boundary-time-ms')) };
  else if (kind === 'motion.cue.create') intent = { kind, creationKey: requireText(options.read('--creation-key')),
    semantic: parseCueSemantic(options) };
  else if (kind === 'motion.cue.update') intent = { kind, cueId: requireText(options.read('--cue-id')),
    semantic: parseCueSemantic(options) };
  else if (kind === 'motion.cue.delete' || kind === 'motion.cue.detach') intent = { kind,
    cueId: requireText(options.read('--cue-id')) };
  else throw new Error('CLI_COMMAND_UNKNOWN');
  const request = { schemaVersion: 'motion.operation-preparation-request.v1', documentId, branchId: options.branchId,
    expectedRevision, kind, intent } as Parameters<MotionServiceClient['prepareOperation']>[0];
  const prepared = await client.prepareOperation(request);
  if (!prepared.eligibility || !prepared.normalizedIntent || !prepared.derivationDigest)
    throw new IneligiblePreparation(prepared);
  return makeOperationIntentCommand({ schemaVersion: 'motion.operation-intent.v1', operationId, documentId,
    expectedRevision, kind, derivationDigest: prepared.derivationDigest,
    intent: prepared.normalizedIntent } as Parameters<typeof makeOperationIntentCommand>[0], options.branchId);
}

function viewport(options: Options): { widthCssPixels: number; heightCssPixels: number } { return {
  widthCssPixels: positiveNumber(options.read('--viewport-width')),
  heightCssPixels: positiveNumber(options.read('--viewport-height')),
}; }
function parseEasing(value: string | undefined): unknown {
  const parts = requireText(value).split(':');
  if (parts[0] === 'keyword' && parts.length === 2) return { kind: 'keyword', value: parts[1] };
  if (parts[0] === 'steps' && parts.length === 3) return { kind: 'steps', count: positiveInteger(parts[1]), position: parts[2] };
  if (parts[0] === 'cubic-bezier' && parts.length === 5) return { kind: 'cubic-bezier', x1: finiteNumber(parts[1]),
    y1: finiteNumber(parts[2]), x2: finiteNumber(parts[3]), y2: finiteNumber(parts[4]) };
  throw new Error('CLI_EASING_INVALID');
}
function parseCueSemantic(options: Options): unknown {
  const semantic = requireText(options.read('--semantic'));
  if (semantic === 'reveal') return { kind: 'reveal', targetIds: many(options.readAll('--target-id'), '--target-id'),
    startMs: nonnegativeInteger(options.read('--start-ms')), completeMs: nonnegativeInteger(options.read('--complete-ms')) };
  if (semantic === 'cursor-path') return { kind: 'cursor-path', cursorTargetId: requireText(options.read('--cursor-target-id')),
    startMs: nonnegativeInteger(options.read('--start-ms')), arriveMs: nonnegativeInteger(options.read('--arrive-ms')),
    easing: parseEasing(options.read('--easing')), waypoints: many(options.readAll('--waypoint'), '--waypoint').map(parseWaypoint) };
  if (semantic === 'click') return { kind: 'click', cursorTargetId: requireText(options.read('--cursor-target-id')),
    pulseTargetId: requireText(options.read('--pulse-target-id')), arriveMs: nonnegativeInteger(options.read('--arrive-ms')),
    pressMs: nonnegativeInteger(options.read('--press-ms')), releaseMs: nonnegativeInteger(options.read('--release-ms')),
    pulseEndMs: nonnegativeInteger(options.read('--pulse-end-ms')), pressScalePpm: positiveInteger(options.read('--press-scale-ppm')),
    pulseRadiusPpm: positiveInteger(options.read('--pulse-radius-ppm')),
    pulseOpacityPpm: positiveInteger(options.read('--pulse-opacity-ppm')),
    ...(options.read('--reveal-cue-id') ? { revealCueId: options.read('--reveal-cue-id') } : {}) };
  throw new Error('CLI_SEMANTIC_INVALID');
}
function parseWaypoint(value: string): { timeMs: number; xPpm: number; yPpm: number } {
  const parts = value.split(':'); if (parts.length !== 3) throw new Error('CLI_WAYPOINT_INVALID');
  return { timeMs: nonnegativeInteger(parts[0]), xPpm: safeInteger(parts[1]), yPpm: safeInteger(parts[2]) };
}
function one(values: string[], name: string): string { if (values.length !== 1) throw new Error(`CLI_${name.slice(2).replaceAll('-', '_').toUpperCase()}_INVALID`); return values[0]!; }
function many(values: string[], name: string): string[] { if (!values.length) throw new Error(`CLI_${name.slice(2).replaceAll('-', '_').toUpperCase()}_REQUIRED`); return values; }
function literal2100(value: string | undefined): 2100 { if (Number(value) !== 2100) throw new Error('CLI_BOUNDARY_TIME_INVALID'); return 2100; }

function envelopeOperation(operation: unknown, branchId: string, kind: string, operationId: string,
  documentId: string, expectedRevision: number): MotionCommand {
  if (!operation || typeof operation !== 'object') throw new Error('CLI_OPERATION_INVALID');
  const value = operation as Record<string, unknown>;
  if (value.kind !== kind || value.operationId !== operationId || value.documentId !== documentId
    || value.expectedRevision !== expectedRevision) throw new Error('CLI_OPERATION_IDENTITY_MISMATCH');
  return commandSchema.parse({ protocolVersion: 'motion.protocol.v1', operationId, documentId, branchId,
    expectedRevision, command: operation });
}

function readCommandFile(path: string | undefined): MotionCommand {
  let input: unknown;
  try { input = readJsonFile(requireText(path)); }
  catch (error) {
    if (error instanceof Error && error.message === 'CLI_OPTION_REQUIRED') throw error;
    throw new CommandInputError(protocolCommandInvalid('$'));
  }
  const parsed = parseCommandDetailed(input); if (!parsed.ok) throw new CommandInputError(parsed.response);
  return parsed.command;
}
function protocolCommandInvalid(fieldPath: string): CommandFailure { return { ok: false, code: 'VALIDATION', diagnostic: {
  schemaVersion: 'motion.diagnostic.v1', code: 'PROTOCOL_COMMAND_INVALID', category: 'protocol', retryable: false, fieldPath,
} }; }
function readJsonFile(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')); }
function requireText(value: string | undefined): string { if (!value) throw new Error('CLI_OPTION_REQUIRED'); return value; }
function requireRevision(value: number | undefined): number { if (value === undefined) throw new Error('CLI_REVISION_REQUIRED'); return value; }
function requireScope(value: string | undefined): 'document' | 'branch' { if (value !== 'document' && value !== 'branch') throw new Error('CLI_SCOPE_INVALID'); return value; }
function finiteNumber(value: string | undefined): number { const number = Number(value); if (!Number.isFinite(number)) throw new Error('CLI_NUMBER_INVALID'); return number; }
function positiveNumber(value: string | undefined): number { const number = finiteNumber(value); if (number <= 0) throw new Error('CLI_NUMBER_INVALID'); return number; }
function safeInteger(value: string | undefined): number { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error('CLI_INTEGER_INVALID'); return number; }
function nonnegativeInteger(value: string | undefined): number { const number = safeInteger(value); if (number < 0) throw new Error('CLI_INTEGER_INVALID'); return number; }
function positiveInteger(value: string | undefined): number { const number = safeInteger(value); if (number < 1) throw new Error('CLI_INTEGER_INVALID'); return number; }
function integerOption(value: string | undefined, fallback: number): number { return value === undefined ? fallback : nonnegativeInteger(value); }
function exitCode(response: CommandResponse): number { if (response.ok) return 0; return {
  VALIDATION: 2, STALE_REVISION: 3, UNAUTHORIZED_CLAIM: 4, OPERATION_ID_CONFLICT: 5,
  UNSUPPORTED_VERSION: 6, STORAGE_FAILURE: 7,
}[response.code]; }

function canonicalJson(value: unknown): string { return `${JSON.stringify(sortJson(value))}\n`; }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli(process.argv.slice(2));
