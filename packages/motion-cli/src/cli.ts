import { runSequence, sequenceExitCode } from './sequence-workflow.ts';
import { sequenceOptions, sequenceViewportRecovery } from './sequence-discovery.ts';
import { downloadShot } from './shot-export.ts';
import { ZodError } from 'zod';
import { admitShot } from './shot-admission.ts';
import { openManagedClaim, type ManagedClaim } from './managed-claims.ts';
import { resolveProject } from './project-context.ts';
import { sessionFetch, listProjects } from './session-context.ts';
import { commandDiscovery, commandDetail, operationKinds, mutationNames, isPreparableOperation } from './command-discovery.ts';
import { parseOptions, parseArgumentValues, type Options } from './arguments.ts';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { MotionServiceClient, commandSchema, makeBranchCreateCommand, makeClaimAcquireCommand,
  makeClaimControlCommand, makeOperationIntentCommand, makeTrackCreateCommand, MotionPreparationError,
  parseCommandDetailed, type ActorKind, type CommandFailure, type CommandResponse,
  type MotionCommand } from '../../motion-protocol/src/index.ts';
import { ReviewServiceClient, parseHandoffRequest, parseReviewCommand, type ReviewResponse } from '../../motion-protocol/src/review.ts';

type Io = { stdout(value: string): void; stderr(value: string): void };
class IneligiblePreparation extends Error { constructor(readonly preparation: unknown) { super('CLI_PREPARATION_INELIGIBLE'); } }
class CommandInputError extends Error { constructor(readonly response: CommandFailure) { super(response.diagnostic.code); } }

export async function runCli(argv: string[], io: Io = {
  stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value),
}): Promise<number> {
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    if (argv.length > 1) return writeLocalFailure(io, 'CLI_OPTIONS_INVALID');
    io.stdout(canonicalJson(commandDiscovery)); return 0;
  }
  if (argv[1] === '--help') {
    if (argv.length !== 2) return writeLocalFailure(io, 'CLI_OPTIONS_INVALID');
    const detail = commandDetail(argv[0]!);
    if (!detail) return writeLocalFailure(io, 'CLI_COMMAND_UNKNOWN');
    io.stdout(canonicalJson(detail)); return 0;
  }
  if (argv[0] === 'claim-secret') { if (argv.length !== 1) return writeLocalFailure(io, 'CLI_OPTIONS_INVALID'); io.stdout(`${randomBytes(32).toString('base64url')}\n`); return 0; }
  if (argv[0] === 'operation-kinds') {
    try { parseArgumentValues(argv); } catch { return writeLocalFailure(io, 'CLI_OPTIONS_INVALID'); }
    io.stdout(canonicalJson({ schemaVersion: 'motion.operation-kind-list.v1', operations: operationKinds })); return 0;
  }
  let managed: ManagedClaim | undefined;
  try {
    if (argv[0] === 'projects') {
      const values = parseArgumentValues(argv);
      if ([...values.keys()].some((name) => name !== '--data-dir')) throw new Error('CLI_OPTIONS_INVALID');
      io.stdout(canonicalJson(listProjects(values.get('--data-dir')?.[0]))); return 0;
    }
    if (!commandDetail(argv[0]!)) return writeLocalFailure(io, 'CLI_OPTIONS_INVALID');
    const options = parseOptions(argv);
    if (argv[0]!.startsWith('review-') && (options.has('--validate') || options.has('--validate-only')))
      throw new Error('CLI_OPTIONS_INVALID');
    if (argv[0] === 'shot-admit') {
      const response = await admitShot(options); io.stdout(canonicalJson(response));
      return response.ok ? 0 : response.code === 'STALE_CATALOG_REVISION' ? 3
        : response.code === 'UNAUTHORIZED_CLAIM' ? 4 : response.code === 'OPERATION_ID_CONFLICT' ? 5
          : response.code === 'STORAGE_FAILURE' ? 7 : 2;
    }
    if (Object.hasOwn(sequenceOptions, argv[0]!)) {
      const response = await runSequence(argv[0]!, options, parseArgumentValues(argv)) as { ok?: boolean; code?: string };
      io.stdout(canonicalJson(response));
      if (response.code === 'SEQUENCE_VIEWPORT_MISMATCH') io.stderr(`${sequenceViewportRecovery}\n`);
      return sequenceExitCode(response);
    }
    const project = await resolveProject(argv[0]!, options);
    if (project !== undefined) { io.stdout(canonicalJson(project)); return 0; }
    if (argv[0] === 'export') {
      const response = await downloadShot(options) as { ok: boolean; code?: string }; io.stdout(canonicalJson(response));
      return response.ok ? 0 : response.code === 'EXPORT_STALE_REVISION' ? 3 : 2;
    }
    managed = await openManagedClaim(argv[0]!, options);
    const client = new MotionServiceClient(options.service, options.session ? sessionFetch : (...args) => fetch(...args), {
      actor: options.actor, capability: options.capability, ...(options.claimSecret ? { claimSecret: options.claimSecret } : {}),
    });
    const reviewClient = new ReviewServiceClient(options.service, options.session ? sessionFetch : (...args) => fetch(...args), {
      actor: options.actor, capability: options.capability, ...(options.claimSecret ? { claimSecret: options.claimSecret } : {}),
    });
    if (argv[0] === 'review-dispatch') {
      const parsed = parseReviewCommand(readJsonFile(requireText(options.commandFile)));
      if (!parsed.ok) { io.stdout(canonicalJson(parsed.response)); return reviewExitCode(parsed.response); }
      if (options.session && (parsed.command.documentId !== options.documentId || parsed.command.branchId !== options.branchId
        || (options.expectedRevision !== undefined && parsed.command.expectedBranchRevision !== options.expectedRevision)
        || (options.operationId !== undefined && parsed.command.operationId !== options.operationId)))
        throw new Error('CLI_COMMAND_IDENTITY_MISMATCH');
      const response = await reviewClient.dispatch(parsed.command); io.stdout(canonicalJson(response)); return reviewExitCode(response);
    }
    if (argv[0] === 'review-annotations') { io.stdout(canonicalJson(await reviewClient.annotations(
      requireText(options.documentId), options.branchId))); return 0; }
    if (argv[0] === 'review-compare') { io.stdout(canonicalJson(await reviewClient.compare(requireText(options.documentId),
      nonnegativeInteger(options.read('--left-revision')), nonnegativeInteger(options.read('--right-revision'))))); return 0; }
    if (argv[0] === 'review-handoff') { const parsed = parseHandoffRequest(readJsonFile(requireText(options.commandFile)));
      if (!parsed.ok) { io.stdout(canonicalJson(parsed.response)); return reviewExitCode(parsed.response); }
      if (options.session && (parsed.identity.documentId !== options.documentId || parsed.identity.branchId !== options.branchId
        || (options.expectedRevision !== undefined && parsed.identity.revision !== options.expectedRevision)
        || (options.operationId !== undefined && parsed.operationId !== options.operationId)))
        throw new Error('CLI_COMMAND_IDENTITY_MISMATCH');
      io.stdout(canonicalJson(await reviewClient.handoff({ operationId: parsed.operationId, ...parsed.identity }))); return 0; }
    const read = await runRead(argv[0]!, options, client);
    if (read !== undefined) { io.stdout(canonicalJson(read)); return 0; }
    let command: MotionCommand;
    if (argv[0] === 'dispatch') command = readCommandFile(options.commandFile);
    else if (argv[0] === 'validate') {
      command = readCommandFile(options.commandFile); managed?.assertIdentity(command); const response = await client.validate(command, options.claimSecret);
      io.stdout(canonicalJson(response)); return response.valid ? 0 : exitCode(response.response as CommandResponse);
    } else command = await buildCommand(argv[0]!, options, client);
    managed?.assertIdentity(command);
    if (options.has('--validate') || options.has('--validate-only')) {
      const validation = await client.validate(command, options.claimSecret);
      if (!validation.valid || options.has('--validate-only')) {
        io.stdout(canonicalJson(validation)); return validation.valid ? 0 : exitCode(validation.response as CommandResponse);
      }
    }
    const response = await client.dispatch(command, options.claimSecret); managed?.observe(response); io.stdout(canonicalJson(response)); return exitCode(response);
  } catch (error) {
    if (error instanceof ZodError) return writeLocalFailure(io, 'CLI_COMMAND_INPUT_INVALID');
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
      elementId, ...(options.has('--duration-ms') ? { durationMs: positiveInteger(options.read('--duration-ms')) } : {}),
      ...(options.has('--delay-ms') ? { delayMs: nonnegativeInteger(options.read('--delay-ms')) } : {}),
      ...(options.has('--start-value') ? { startValue: finiteNumber(options.read('--start-value')) } : {}),
      ...(options.has('--end-value') ? { endValue: finiteNumber(options.read('--end-value')) } : {}) });
  }
  if (kind === 'motion.hold.insert') {
    const cueId = requireText(options.read('--cue-id'));
    if (!workspace.cues.some((cue) => cue.cueId === cueId)) throw new Error('CLI_CUE_NOT_DISCOVERED');
    return envelopeOperation({ schemaVersion: 'motion.operation.v1', kind, operationId, documentId, expectedRevision,
      payload: { cueId, durationMs: positiveInteger(options.read('--duration-ms')) } }, options.branchId, kind, operationId, documentId, expectedRevision);
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
    boundaryTimeMs: nonnegativeInteger(options.read('--boundary-time-ms')) };
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
  if (semantic === 'type') return { kind: 'type', targetId: one(options.readAll('--target-id'), '--target-id'),
    startMs: nonnegativeInteger(options.read('--start-ms')), completeMs: nonnegativeInteger(options.read('--complete-ms')),
    stepCount: positiveInteger(options.read('--step-count')) };
  if (semantic === 'select') return { kind: 'select', cursorTargetId: requireText(options.read('--cursor-target-id')),
    selectedTargetId: requireText(options.read('--selected-target-id')),
    ...(options.read('--highlight-target-id') ? { highlightTargetId: options.read('--highlight-target-id') } : {}),
    approachMs: nonnegativeInteger(options.read('--approach-ms')), chooseMs: nonnegativeInteger(options.read('--choose-ms')),
    settleMs: nonnegativeInteger(options.read('--settle-ms')) };
  if (semantic === 'drag') return { kind: 'drag', cursorTargetId: requireText(options.read('--cursor-target-id')),
    draggedTargetId: requireText(options.read('--dragged-target-id')),
    approachMs: nonnegativeInteger(options.read('--approach-ms')), pressMs: nonnegativeInteger(options.read('--press-ms')),
    moveStartMs: nonnegativeInteger(options.read('--move-start-ms')), arriveMs: nonnegativeInteger(options.read('--arrive-ms')),
    releaseMs: nonnegativeInteger(options.read('--release-ms')), grabOffsetXPpm: safeInteger(options.read('--grab-offset-x-ppm')),
    grabOffsetYPpm: safeInteger(options.read('--grab-offset-y-ppm')),
    waypoints: many(options.readAll('--waypoint'), '--waypoint').map(parseWaypoint) };
  if (semantic === 'hold') return { kind: 'hold', targetIds: many(options.readAll('--target-id'), '--target-id'),
    enterMs: nonnegativeInteger(options.read('--enter-ms')), durationMs: positiveInteger(options.read('--duration-ms')),
    exitMs: nonnegativeInteger(options.read('--exit-ms')) };
  throw new Error('CLI_SEMANTIC_INVALID');
}
function parseWaypoint(value: string): { timeMs: number; xPpm: number; yPpm: number } {
  const parts = value.split(':'); if (parts.length !== 3) throw new Error('CLI_WAYPOINT_INVALID');
  return { timeMs: nonnegativeInteger(parts[0]), xPpm: safeInteger(parts[1]), yPpm: safeInteger(parts[2]) };
}
function one(values: string[], name: string): string { if (values.length !== 1) throw new Error(`CLI_${name.slice(2).replaceAll('-', '_').toUpperCase()}_INVALID`); return values[0]!; }
function many(values: string[], name: string): string[] { if (!values.length) throw new Error(`CLI_${name.slice(2).replaceAll('-', '_').toUpperCase()}_REQUIRED`); return values; }

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
function readJsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('CLI_COMMAND_FILE_INVALID'); }
}
function requireText(value: string | undefined): string { if (!value) throw new Error('CLI_OPTION_REQUIRED'); return value; }
function requireRevision(value: number | undefined): number { if (value === undefined) throw new Error('CLI_REVISION_REQUIRED'); return value; }
function requireScope(value: string | undefined): 'document' | 'branch' { if (value !== 'document' && value !== 'branch') throw new Error('CLI_SCOPE_INVALID'); return value; }
function finiteNumber(value: string | undefined): number { const number = Number(value); if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(number)) throw new Error('CLI_NUMBER_INVALID'); return number; }
function positiveNumber(value: string | undefined): number { const number = finiteNumber(value); if (number <= 0) throw new Error('CLI_NUMBER_INVALID'); return number; }
function safeInteger(value: string | undefined): number { const number = Number(value); if (value === undefined || !/^-?\d+$/.test(value) || !Number.isSafeInteger(number)) throw new Error('CLI_INTEGER_INVALID'); return number; }
function nonnegativeInteger(value: string | undefined): number { const number = safeInteger(value); if (number < 0) throw new Error('CLI_INTEGER_INVALID'); return number; }
function positiveInteger(value: string | undefined): number { const number = safeInteger(value); if (number < 1) throw new Error('CLI_INTEGER_INVALID'); return number; }
function integerOption(value: string | undefined, fallback: number): number { return value === undefined ? fallback : nonnegativeInteger(value); }
function exitCode(response: CommandResponse): number { if (response.ok) return 0; return {
  VALIDATION: 2, STALE_REVISION: 3, UNAUTHORIZED_CLAIM: 4, OPERATION_ID_CONFLICT: 5,
  UNSUPPORTED_VERSION: 6, STORAGE_FAILURE: 7,
}[response.code]; }
function reviewExitCode(response: ReviewResponse): number { if (response.ok) return 0; return {
  VALIDATION: 2, STALE_BRANCH_REVISION: 3, STALE_ANNOTATION_VERSION: 3, UNAUTHORIZED_CLAIM: 4,
  OPERATION_ID_CONFLICT: 5, UNSUPPORTED_VERSION: 6, STORAGE_FAILURE: 7,
}[response.code]; }

function canonicalJson(value: unknown): string { return `${JSON.stringify(sortJson(value))}\n`; }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli(process.argv.slice(2));
