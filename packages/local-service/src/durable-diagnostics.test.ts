import { describe, expect, test } from 'vitest';

import { canonicalBytes, canonicalContentBytes, canonicalJson, createAuthoringState, cueTargetSnapshots, deriveCueId,
  dispatchAuthoringOperation, DURABLE_OPERATION_KINDS, isAuthoringCue,
  projectCueReplacement, projectTrajectorySelection, projectTransformTrajectory, sha256Hex, type CueAuthoringOperation, type CueSemantic,
  type MotionDocument, type OperationIntentPayload, type OperationPreparationRequest,
  type TrajectoryAuthoringOperation } from '../../domain/src/index.js';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { commandSchema, makeBranchCreateCommand, makeClaimAcquireCommand, makeClaimControlCommand, makeCueCommand,
  makeOperationIntentCommand, makeTrackCreateCommand, MotionServiceClient,
  operationSchema, PROTOCOL_VERSION } from '../../motion-protocol/src/index.js';
import { startLocalMotionService } from './index.js';
import { createTrajectorySeed } from './seed.js';
import { phase3Seed, temporaryStore } from './test-support.js';

const claimProof = ['durable', 'contract', 'agent', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
const envelope = (command: Record<string, unknown>, documentId: string, revision: number) => commandSchema.parse({
  protocolVersion: PROTOCOL_VERSION, operationId: command.operationId, documentId, branchId: 'main',
  expectedRevision: revision, command,
});

type IntentCase = { name: string; seed: MotionDocument; request: OperationPreparationRequest; expected: MotionDocument };

function intentCases(): IntentCase[] {
  const trajectory = createTrajectorySeed(); const ids = trajectory.elements.map((element) => element.id).sort();
  const trajectoryIntents: OperationIntentPayload[] = [
    { kind: 'motion.transform-pose.set', elementId: ids[0]!, momentMs: 700,
      pose: { translateXMicrounits: 123_000_000, translateYMicrounits: 45_000_000,
        scalePpm: 1_100_000, rotateMicrodegrees: 5_000_000 }, viewport: { widthCssPixels: 800, heightCssPixels: 450 } },
    { kind: 'motion.transform-waypoints.translate', elementIds: ids, momentMs: 700,
      deltaXPpm: 10_000, deltaYPpm: -10_000, viewport: { widthCssPixels: 800, heightCssPixels: 450 } },
    { kind: 'motion.transform-waypoint.add', elementIds: ids, timeMs: 350 },
    { kind: 'motion.keyframe-group-time.set', elementIds: ids, sourceTimeMs: 700,
      targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 },
    { kind: 'motion.keyframe-group-easing.set', elementIds: ids, momentMs: 700,
      expectedEasing: { kind: 'keyword', value: 'ease-out' }, easing: { kind: 'keyword', value: 'ease-in-out' } },
    { kind: 'motion.settled-hold.set', elementIds: ids, sourceTimeMs: 2100,
      settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 },
  ];
  const cueBase = phase3Seed(); const cueSemantic: CueSemantic = { kind: 'reveal',
    targetIds: [cueBase.elements[0]!.id], startMs: 100, completeMs: 500 };
  const cueCreated = applyLegacy(cueBase, { kind: 'motion.cue.create', creationKey: 'matrix-cue', semantic: cueSemantic });
  const cue = cueCreated.cues.find(isAuthoringCue); if (!cue) throw new Error('MATRIX_CUE_MISSING');
  const entries: Array<{ name: string; seed: MotionDocument; intent: OperationIntentPayload }> = [
    ...trajectoryIntents.map((intent) => ({ name: intent.kind.replace('motion.', '').replaceAll('.', '-'),
      seed: structuredClone(trajectory), intent })),
    { name: 'cue-create', seed: structuredClone(cueBase),
      intent: { kind: 'motion.cue.create', creationKey: 'matrix-cue', semantic: cueSemantic } },
    { name: 'cue-update', seed: structuredClone(cueCreated),
      intent: { kind: 'motion.cue.update', cueId: cue.id, semantic: { ...cueSemantic, completeMs: 600 } } },
    { name: 'cue-delete', seed: structuredClone(cueCreated), intent: { kind: 'motion.cue.delete', cueId: cue.id } },
    { name: 'cue-detach', seed: structuredClone(cueCreated), intent: { kind: 'motion.cue.detach', cueId: cue.id } },
  ];
  return entries.map(({ name, seed, intent }) => ({ name, seed, request: {
    schemaVersion: 'motion.operation-preparation-request.v1', documentId: seed.documentId, branchId: 'main',
    expectedRevision: seed.revision, kind: intent.kind, intent,
  }, expected: applyLegacy(seed, intent) }));
}

function applyLegacy(document: MotionDocument, intent: OperationIntentPayload): MotionDocument {
  const operation = independentLegacyOperation(document, intent);
  const result = dispatchAuthoringOperation(createAuthoringState(document), operation, document.revision + 1);
  if (!result.ok) throw new Error(`MATRIX_DISPATCH_FAILED:${result.diagnostic.code}`); return result.state.document;
}

function independentLegacyOperation(document: MotionDocument, intent: OperationIntentPayload):
  TrajectoryAuthoringOperation | CueAuthoringOperation {
  const base = { schemaVersion: 'motion.operation.v1' as const, operationId: `legacy-${intent.kind}`,
    documentId: document.documentId, expectedRevision: document.revision };
  const select = (elementIds: string[], momentMs: number) => { const result = projectTrajectorySelection(document, elementIds, momentMs);
    if (!result.eligible) throw new Error(`LEGACY_SELECTION_FAILED:${result.code}`); return result.targets; };
  const stage = (viewport: { widthCssPixels: number; heightCssPixels: number }) => {
    const widthMicrounits = viewport.widthCssPixels * 1_000_000;
    const heightMicrounits = viewport.heightCssPixels * 1_000_000;
    return { stageDigest: sha256Hex(`${compileMotionDocument(document).exportDigest}\0${widthMicrounits}\0${heightMicrounits}`),
      widthMicrounits, heightMicrounits };
  };
  if (intent.kind === 'motion.transform-pose.set') {
    const target = select([intent.elementId], intent.momentMs)[0]!;
    return { ...base, kind: intent.kind, ...target, payload: { pose: intent.pose, stage: stage(intent.viewport) } };
  }
  if (intent.kind === 'motion.transform-waypoints.translate') return { ...base, kind: intent.kind,
    payload: { targets: select(intent.elementIds, intent.momentMs), deltaXPpm: intent.deltaXPpm,
      deltaYPpm: intent.deltaYPpm, stage: stage(intent.viewport) } };
  if (intent.kind === 'motion.transform-waypoint.add') return { ...base, kind: intent.kind, payload: {
    timeMs: intent.timeMs,
    targets: [...intent.elementIds].sort().map((elementId) => {
      const trajectory = projectTransformTrajectory(document, elementId);
      if (!trajectory.eligible) throw new Error(`LEGACY_TRAJECTORY_FAILED:${trajectory.code}`);
      const afterIndex = trajectory.waypoints.findIndex((waypoint) => waypoint.timeMs > intent.timeMs);
      const before = trajectory.waypoints[afterIndex - 1]; const after = trajectory.waypoints[afterIndex];
      if (!before || !after) throw new Error('LEGACY_INSERTION_BOUNDARY_MISSING');
      return { elementId, trackId: trajectory.trackId, beforeKeyframeId: before.keyframeId,
        afterKeyframeId: after.keyframeId, expectedBeforeTransform: before.transformBytes,
        expectedAfterTransform: after.transformBytes };
    }),
  } };
  if (intent.kind === 'motion.transform-waypoint.remove') return { ...base, kind: intent.kind,
    payload: { targets: select(intent.elementIds, intent.timeMs), timeMs: intent.timeMs } };
  if (intent.kind === 'motion.keyframe-group-time.set') return { ...base, kind: intent.kind,
    payload: { targets: select(intent.elementIds, intent.sourceTimeMs), sourceTimeMs: intent.sourceTimeMs,
      targetTimeMs: intent.targetTimeMs, landingTimeMs: intent.landingTimeMs, settledTimeMs: intent.settledTimeMs } };
  if (intent.kind === 'motion.keyframe-group-easing.set') return { ...base, kind: intent.kind,
    payload: { targets: select(intent.elementIds, intent.momentMs), expectedEasing: intent.expectedEasing,
      easing: intent.easing } };
  if (intent.kind === 'motion.settled-hold.set') return { ...base, kind: intent.kind,
    payload: { targets: select(intent.elementIds, intent.sourceTimeMs), sourceTimeMs: intent.sourceTimeMs,
      settledTimeMs: intent.settledTimeMs, landingTimeMs: intent.landingTimeMs, boundaryTimeMs: intent.boundaryTimeMs } };
  if (intent.kind === 'motion.cue.create') {
    const cueId = deriveCueId(document.documentId, intent.creationKey);
    const replacement = projectCueReplacement(document, cueId, intent.semantic);
    if (!replacement.ok) throw new Error(`LEGACY_REPLACEMENT_FAILED:${replacement.code}`);
    return { ...base, kind: intent.kind, payload: { cueId, semantic: intent.semantic,
      targetSnapshots: cueTargetSnapshots(document, intent.semantic), replacementTrackIds: replacement.trackIds,
      replacementInputDigest: replacement.inputDigest } };
  }
  const cue = document.cues.find((candidate) => isAuthoringCue(candidate) && candidate.id === intent.cueId);
  if (!cue || !isAuthoringCue(cue)) throw new Error('LEGACY_CUE_MISSING');
  if (intent.kind === 'motion.cue.update') return { ...base, kind: intent.kind, payload: { cueId: cue.id,
    expectedExpansionDigest: cue.expansionDigest, semantic: intent.semantic,
    targetSnapshots: cueTargetSnapshots(document, intent.semantic) } };
  return { ...base, kind: intent.kind, payload: { cueId: cue.id, expectedExpansionDigest: cue.expansionDigest,
    expectedReplacementInputDigest: cue.replacement?.inputDigest ?? null } };
}

function independentAffectedIds(operation: TrajectoryAuthoringOperation | CueAuthoringOperation): string[] {
  if (operation.kind === 'motion.transform-pose.set') return [operation.elementId, operation.trackId,
    operation.keyframeId].sort();
  if (operation.kind === 'motion.transform-waypoint.add') return [...new Set(operation.payload.targets.flatMap((target) =>
    [target.elementId, target.trackId]))].sort();
  if (operation.kind === 'motion.transform-waypoints.translate' || operation.kind === 'motion.transform-waypoint.remove'
    || operation.kind === 'motion.keyframe-group-time.set'
    || operation.kind === 'motion.keyframe-group-easing.set' || operation.kind === 'motion.settled-hold.set') {
    return [...new Set(operation.payload.targets.flatMap((target) =>
      [target.elementId, target.trackId, target.keyframeId]))].sort();
  }
  return [operation.payload.cueId];
}


describe('durable diagnostics and dispatch contract', () => {
  test('serves six deterministic sanitized reads and validates without state or allocation effects across restart', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let now = 1_000;
    let service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, now: () => now });
    const human = new MotionServiceClient(service.url); const agent = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: 'cli-agent', claimSecret: claimProof });
    const create = makeTrackCreateCommand({ operationId: 'durable-validate-create', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' });
    const before = service.store.snapshot();
    const validationBytes = canonicalJson(await human.validate(create));
    expect(validationBytes).toBe(canonicalJson(await human.validate(create)));
    expect(JSON.parse(validationBytes)).toEqual({ schemaVersion: 'motion.command-validation.v1', valid: true,
      response: { ok: true } });
    expect(service.store.snapshot()).toEqual(before);

    const missing = commandSchema.parse({ ...create, operationId: 'durable-missing', command: {
      ...create.command, operationId: 'durable-missing', elementId: 'el_2dbee68b1ea318c8',
    } });
    const missingBefore = service.store.snapshot(); const missingValidation = await human.validate(missing);
    expect(missingValidation).toMatchObject({ valid: true });
    expect(service.store.snapshot()).toEqual(missingBefore);

    const accepted = await human.dispatch(create); expect(accepted).toMatchObject({ ok: true, resultingRevision: 1 });
    const acquired = await agent.dispatch(makeClaimAcquireCommand({ operationId: 'durable-claim', documentId: seed.documentId,
      expectedRevision: 1, scope: 'document' })); expect(acquired).toMatchObject({ ok: true });
    const [workspace, branches, claims, activity, exportA, exportB, exportC] = await Promise.all([
      human.workspace(seed.documentId), human.branches(seed.documentId), human.activeClaims(seed.documentId),
      human.activity(seed.documentId, 0, 1), human.exportProof(seed.documentId), human.exportProof(seed.documentId),
      human.exportProof(seed.documentId),
    ]);
    expect(workspace).toMatchObject({ schemaVersion: 'motion.workspace-projection.v1', revision: 1,
      history: { undoAvailable: true, redoAvailable: false } });
    expect(branches.branches).toEqual([expect.objectContaining({ branchId: 'main', headRevision: 1 })]);
    expect(claims.claims).toEqual([expect.objectContaining({ holder: {
      kind: 'agent', actorId: expect.stringMatching(/^actor_[a-f0-9]{24}$/),
    } })]);
    expect(activity).toMatchObject({ schemaVersion: 'motion.activity-page.v1', nextAfterCommitSeq: 1,
      events: [{ actor: { kind: 'human', actorId: expect.stringMatching(/^actor_[a-f0-9]{24}$/) },
        affectedIds: expect.any(Array), operationDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
    expect(exportA).toEqual(exportB); expect(exportB).toEqual(exportC);
    const publicBytes = canonicalJson({ workspace, branches, claims, activity, exportA });
    for (const forbidden of ['selectorHint', 'structuralFingerprint', 'presentation', 'human-editor',
      'cli-agent', claimProof, 'token_hash', 'private_payload_json', '<div', 'https://']) expect(publicBytes).not.toContain(forbidden);

    await service.close(); service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, now: () => now });
    const restarted = new MotionServiceClient(service.url);
    expect(await restarted.workspace(seed.documentId)).toEqual(workspace);
    expect(await restarted.activeClaims(seed.documentId)).toEqual(claims);
    expect((await restarted.activity(seed.documentId, 0, 10)).events[0]?.actor).toEqual(activity.events[0]?.actor);
    now += 120_000; expect((await restarted.activeClaims(seed.documentId)).claims).toEqual([]);
    await service.close(); await temporary.cleanup();
  });

  test('dispatches every promoted authoring mutation atomically under the shared envelope', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const client = new MotionServiceClient(service.url); const documentId = seed.documentId;
    const created = await client.dispatch(makeTrackCreateCommand({ operationId: 'promoted-create', documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' })); expect(created.ok).toBe(true);
    let head = await client.head(documentId); const track = head.document.tracks.find((candidate) =>
      candidate.elementId === 'el_a2849ff826f3e167' && candidate.property === 'opacity')!;
    const op = (kind: string, operationId: string, revision: number, rest: Record<string, unknown>) => envelope({
      schemaVersion: 'motion.operation.v1', kind, operationId, documentId, expectedRevision: revision, ...rest,
    }, documentId, revision);
    expect((await client.dispatch(op('motion.keyframe.add', 'promoted-add', 1, { elementId: track.elementId,
      trackId: track.id, payload: { timeMs: 1110, value: 0.5 } }))).ok).toBe(true);
    head = await client.head(documentId); const midpoint = head.document.tracks.find((item) => item.id === track.id)!.keyframeIds[1]!;
    const operations = [
      op('motion.slot-duration.set', 'promoted-duration', 2, { elementId: track.elementId, trackId: track.id,
        payload: { durationMs: 1400 } }),
      op('motion.binding-delay.set', 'promoted-delay', 3, { elementId: track.elementId, trackId: track.id,
        payload: { delayMs: 700 } }),
      op('motion.slot-easing.set', 'promoted-easing', 4, { elementId: track.elementId, trackId: track.id,
        payload: { easing: 'ease-in-out' } }),
      op('motion.keyframe-value.set', 'promoted-value', 5, { elementId: track.elementId, trackId: track.id,
        keyframeId: midpoint, payload: { value: 0.6 } }),
      op('motion.keyframe-time.set', 'promoted-time', 6, { elementId: track.elementId, trackId: track.id,
        keyframeId: midpoint, payload: { timeMs: 1540 } }),
    ];
    for (const [index, command] of operations.entries()) expect(await client.dispatch(command), String(index))
      .toMatchObject({ ok: true, resultingRevision: index + 3 });
    expect((await client.head(documentId)).document.revision).toBe(7);
    await service.close(); await temporary.cleanup();

    const removeTemporary = await temporaryStore(); const removeService = await startLocalMotionService({
      databasePath: removeTemporary.databasePath, seed }); const removeClient = new MotionServiceClient(removeService.url);
    await removeClient.dispatch(makeTrackCreateCommand({ operationId: 'remove-create', documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }));
    const removeHead = await removeClient.head(documentId); const removeTrack = removeHead.document.tracks.find((candidate) =>
      candidate.elementId === 'el_a2849ff826f3e167' && candidate.property === 'opacity')!;
    await removeClient.dispatch(op('motion.keyframe.add', 'remove-add', 1, { elementId: removeTrack.elementId,
      trackId: removeTrack.id, payload: { timeMs: 1110, value: 0.5 } }));
    const removeMidpoint = (await removeClient.head(documentId)).document.tracks.find((item) => item.id === removeTrack.id)!.keyframeIds[1]!;
    expect(await removeClient.dispatch(op('motion.keyframe.remove', 'promoted-remove', 2, { elementId: removeTrack.elementId,
      trackId: removeTrack.id, keyframeId: removeMidpoint }))).toMatchObject({ ok: true, resultingRevision: 3 });
    expect(await removeClient.dispatch(op('motion.hold.insert', 'promoted-hold', 3, {
      payload: { cueId: 'cue_pair', durationMs: 600 },
    }))).toMatchObject({ ok: true, resultingRevision: 4 });
    await removeService.close(); await removeTemporary.cleanup();
  });

  test('dispatches the complete cue create/update/delete/detach lifecycle through the service', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const client = new MotionServiceClient(service.url); const targetId = seed.elements[0]!.id;
    const createCue = async (operationId: string, creationKey: string, revision: number) => {
      const head = (await client.head(seed.documentId)).document;
      const cueId = deriveCueId(seed.documentId, creationKey);
      const semantic: CueSemantic = { kind: 'reveal', targetIds: [targetId], startMs: 100, completeMs: 500 };
      const replacement = projectCueReplacement(head, cueId, semantic); if (!replacement.ok) throw new Error(replacement.code);
      const operation: CueAuthoringOperation = { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.create',
        operationId, documentId: seed.documentId, expectedRevision: revision, payload: { cueId, semantic,
          targetSnapshots: cueTargetSnapshots(head, semantic), replacementTrackIds: replacement.trackIds,
          replacementInputDigest: replacement.inputDigest } };
      expect(await client.dispatch(makeCueCommand(operation))).toMatchObject({ ok: true, resultingRevision: revision + 1 });
      return cueId;
    };
    const firstId = await createCue('cue-lifecycle-create', 'lifecycle-one', 0);
    let head = (await client.head(seed.documentId)).document; let cue = head.cues.find((candidate) => candidate.id === firstId);
    if (!isAuthoringCue(cue)) throw new Error('CUE_LIFECYCLE_MISSING');
    const updatedSemantic: CueSemantic = { kind: 'reveal', targetIds: [targetId], startMs: 150, completeMs: 550 };
    expect(await client.dispatch(makeCueCommand({ schemaVersion: 'motion.operation.v1', kind: 'motion.cue.update',
      operationId: 'cue-lifecycle-update', documentId: seed.documentId, expectedRevision: 1,
      payload: { cueId: firstId, expectedExpansionDigest: cue.expansionDigest, semantic: updatedSemantic,
        targetSnapshots: cueTargetSnapshots(head, updatedSemantic) } }))).toMatchObject({ ok: true, resultingRevision: 2 });
    head = (await client.head(seed.documentId)).document; cue = head.cues.find((candidate) => candidate.id === firstId);
    if (!isAuthoringCue(cue)) throw new Error('CUE_LIFECYCLE_UPDATE_MISSING');
    expect(await client.dispatch(makeCueCommand({ schemaVersion: 'motion.operation.v1', kind: 'motion.cue.delete',
      operationId: 'cue-lifecycle-delete', documentId: seed.documentId, expectedRevision: 2,
      payload: { cueId: firstId, expectedExpansionDigest: cue.expansionDigest,
        expectedReplacementInputDigest: cue.replacement?.inputDigest ?? null } }))).toMatchObject({ ok: true, resultingRevision: 3 });
    const secondId = await createCue('cue-lifecycle-create-two', 'lifecycle-two', 3);
    head = (await client.head(seed.documentId)).document; cue = head.cues.find((candidate) => candidate.id === secondId);
    if (!isAuthoringCue(cue)) throw new Error('CUE_LIFECYCLE_DETACH_MISSING');
    expect(await client.dispatch(makeCueCommand({ schemaVersion: 'motion.operation.v1', kind: 'motion.cue.detach',
      operationId: 'cue-lifecycle-detach', documentId: seed.documentId, expectedRevision: 4,
      payload: { cueId: secondId, expectedExpansionDigest: cue.expansionDigest,
        expectedReplacementInputDigest: cue.replacement?.inputDigest ?? null } }))).toMatchObject({ ok: true, resultingRevision: 5 });
    await service.close(); await temporary.cleanup();
  });

  test('returns canonical parser, reducer, stale, claim, conflict, and storage-safe diagnostics from validation', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed }); const client = new MotionServiceClient(service.url);
    const malformed = await fetch(`${service.url}/api/v1/commands/validate`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer human-editor', 'x-motion-actor': 'human',
    }, body: canonicalJson({ protocolVersion: PROTOCOL_VERSION }) });
    expect(await malformed.json()).toMatchObject({ valid: false, response: { diagnostic: {
      code: 'PROTOCOL_COMMAND_INVALID', category: 'protocol', fieldPath: expect.stringMatching(/^\$/),
    } } });
    const stale = makeTrackCreateCommand({ operationId: 'diagnostic-stale', documentId: seed.documentId,
      expectedRevision: 1, elementId: 'el_a2849ff826f3e167' });
    expect(await client.validate(stale)).toMatchObject({ valid: false, response: { code: 'STALE_REVISION',
      diagnostic: { code: 'STALE_REVISION', retryable: true, currentRevision: 0 } } });
    const missing = commandSchema.parse({ ...makeTrackCreateCommand({ operationId: 'diagnostic-missing', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }), branchId: 'missing' });
    expect(await client.validate(missing)).toMatchObject({ valid: false, response: { diagnostic: { code: 'BRANCH_NOT_FOUND' } } });
    const missingTrack = envelope({ schemaVersion: 'motion.operation.v1', kind: 'motion.keyframe-value.set',
      operationId: 'diagnostic-target', documentId: seed.documentId, expectedRevision: 0,
      elementId: seed.elements[0]!.id, trackId: 'track_missing', keyframeId: 'keyframe_missing', payload: { value: 0.5 } },
    seed.documentId, 0);
    expect(await client.validate(missingTrack)).toMatchObject({ valid: false, response: { diagnostic: {
      code: 'AUTHORING_TRACK_NOT_FOUND', category: 'target', affectedIds: expect.arrayContaining(['track_missing']),
    } } });
    expect(await new MotionServiceClient(service.url, (...args) => fetch(...args), { actor: 'agent', capability: 'cli-agent' })
      .validate(makeTrackCreateCommand({ operationId: 'diagnostic-claim', documentId: seed.documentId, expectedRevision: 0,
        elementId: 'el_a2849ff826f3e167' }))).toMatchObject({ valid: false, response: { diagnostic: { code: 'CLAIM_REQUIRED' } } });
    expect(await new MotionServiceClient(service.url).validate(makeClaimAcquireCommand({ operationId: 'diagnostic-forbidden',
      documentId: seed.documentId, expectedRevision: 0, scope: 'document' }))).toMatchObject({ valid: false,
      response: { diagnostic: { code: 'ACTOR_FORBIDDEN' } } });
    expect(service.store.snapshot()).toMatchObject({ events: [], claims: [] });
    await service.close(); await temporary.cleanup();
  });
  test('returns exact deterministic diagnostics from actual dispatch for every failure class and claim subtype', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let now = 1_000;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, now: () => now });
    const human = new MotionServiceClient(service.url); const proofA = ['claim', 'proof', 'a', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const proofB = ['claim', 'proof', 'b', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const agent = (proof?: string) => new MotionServiceClient(service.url, (...args) => fetch(...args), {
      actor: 'agent', capability: 'cli-agent', ...(proof ? { claimSecret: proof } : {}),
    });
    const expectDiagnostic = async (promise: Promise<Awaited<ReturnType<typeof human.dispatch>>>, code: string) => {
      const response = await promise; expect(response.ok).toBe(false); if (response.ok) throw new Error('EXPECTED_FAILURE');
      expect(response.diagnostic).toMatchObject({ schemaVersion: 'motion.diagnostic.v1', code }); return response;
    };
    const parser = await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer human-editor', 'x-motion-actor': 'human',
    }, body: canonicalJson({ protocolVersion: PROTOCOL_VERSION }) });
    expect(await parser.json()).toMatchObject({ diagnostic: { code: 'PROTOCOL_COMMAND_INVALID', fieldPath: expect.stringMatching(/^\$/) } });
    const invalidCapability = ['not', 'a', 'capability'].join('-'); const beforeUnauthorized = service.store.snapshot();
    const unauthorized = await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${invalidCapability}`, 'x-motion-actor': 'human',
    }, body: canonicalJson(makeTrackCreateCommand({ operationId: 'dispatch-invalid-auth', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' })) });
    expect(unauthorized.status).toBe(403); expect(await unauthorized.json()).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM',
      diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'ACTOR_FORBIDDEN',
        category: 'authorization', retryable: false } });
    expect(service.store.snapshot()).toEqual(beforeUnauthorized);
    const missingCommand = envelope({ schemaVersion: 'motion.operation.v1', kind: 'motion.keyframe-value.set',
      operationId: 'dispatch-missing', documentId: seed.documentId, expectedRevision: 0, elementId: seed.elements[0]!.id,
      trackId: 'track_missing', keyframeId: 'keyframe_missing', payload: { value: 0.5 } }, seed.documentId, 0);
    const stable = service.store.snapshot(); const dispatchedMissing = await expectDiagnostic(
      human.dispatch(missingCommand), 'AUTHORING_TRACK_NOT_FOUND');
    const validatedMissing = await human.validate(missingCommand); expect(validatedMissing.valid).toBe(false);
    if (!validatedMissing.response.ok && !dispatchedMissing.ok) expect(validatedMissing.response.diagnostic)
      .toEqual(dispatchedMissing.diagnostic);
    const rawFailure = async () => (await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer human-editor', 'x-motion-actor': 'human',
    }, body: canonicalJson(missingCommand) })).text();
    const failureBytes = await Promise.all([rawFailure(), rawFailure(), rawFailure()]);
    expect(new Set(failureBytes).size).toBe(1); expect(JSON.parse(failureBytes[0]!)).toMatchObject({
      diagnostic: { code: 'AUTHORING_TRACK_NOT_FOUND', category: 'target' },
    }); expect(service.store.snapshot()).toEqual(stable);
    await expectDiagnostic(human.dispatch(makeTrackCreateCommand({ operationId: 'dispatch-stale', documentId: seed.documentId,
      expectedRevision: 1, elementId: 'el_a2849ff826f3e167' })), 'STALE_REVISION'); expect(service.store.snapshot()).toEqual(stable);
    const branch = makeBranchCreateCommand({ operationId: 'dispatch-conflict', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' }); expect((await human.dispatch(branch)).ok).toBe(true);
    const afterBranch = service.store.snapshot(); await expectDiagnostic(human.dispatch(makeBranchCreateCommand({
      operationId: 'dispatch-conflict', documentId: seed.documentId, expectedRevision: 0, branchId: 'other',
    })), 'OPERATION_ID_CONFLICT'); expect(service.store.snapshot()).toEqual(afterBranch);
    await expectDiagnostic(human.dispatch(makeClaimAcquireCommand({ operationId: 'dispatch-forbidden', documentId: seed.documentId,
      expectedRevision: 0, scope: 'document' })), 'ACTOR_FORBIDDEN');
    await expectDiagnostic(agent().dispatch(makeTrackCreateCommand({ operationId: 'dispatch-required', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: 0, elementId: 'el_a2849ff826f3e167' })), 'CLAIM_REQUIRED');
    const acquired = await agent(proofA).dispatch(makeClaimAcquireCommand({ operationId: 'dispatch-acquire',
      documentId: seed.documentId, branchId: 'feature', expectedRevision: 0, scope: 'branch' }));
    if (!acquired.ok || !acquired.claimId) throw new Error('CLAIM_ACQUIRE_FAILED');
    await expectDiagnostic(agent(proofB).dispatch(makeClaimAcquireCommand({ operationId: 'dispatch-overlap',
      documentId: seed.documentId, branchId: 'feature', expectedRevision: 0, scope: 'branch' })), 'CLAIM_OVERLAP');
    await expectDiagnostic(agent(proofB).dispatch(makeClaimControlCommand({ kind: 'motion.claim.renew', operationId: 'dispatch-secret',
      documentId: seed.documentId, branchId: 'feature', expectedRevision: 0, claimId: acquired.claimId, leaseVersion: 1 })),
    'CLAIM_SECRET_INVALID');
    await expectDiagnostic(agent(proofA).dispatch(makeClaimControlCommand({ kind: 'motion.claim.renew', operationId: 'dispatch-lease',
      documentId: seed.documentId, branchId: 'feature', expectedRevision: 0, claimId: acquired.claimId, leaseVersion: 99 })),
    'CLAIM_LEASE_STALE');
    await expectDiagnostic(agent(proofA).dispatch(makeTrackCreateCommand({ operationId: 'dispatch-scope', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 0, elementId: 'el_a2849ff826f3e167' })), 'CLAIM_SCOPE_MISMATCH');
    now += 120_000; await expectDiagnostic(agent(proofA).dispatch(makeTrackCreateCommand({ operationId: 'dispatch-expired',
      documentId: seed.documentId, branchId: 'feature', expectedRevision: 0, elementId: 'el_a2849ff826f3e167' })), 'CLAIM_EXPIRED');
    await service.close(); await temporary.cleanup();

    const faultTemporary = await temporaryStore(); let injected = false; const faultService = await startLocalMotionService({
      databasePath: faultTemporary.databasePath, seed, fault: (point) => { if (!injected && point === 'after-inserts') {
        injected = true; throw new Error('SYNTHETIC_STORE_FAULT');
      } } });
    const faultBefore = faultService.store.snapshot(); const faultClient = new MotionServiceClient(faultService.url);
    const storage = await faultClient.dispatch(makeTrackCreateCommand({ operationId: 'dispatch-storage', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }));
    expect(storage.ok).toBe(false); if (!storage.ok) expect(storage.diagnostic).toMatchObject({ code: 'STORAGE_FAILURE',
      category: 'storage', retryable: true }); expect(faultService.store.snapshot()).toEqual(faultBefore);
    await faultService.close(); await faultTemporary.cleanup();
  });
});
