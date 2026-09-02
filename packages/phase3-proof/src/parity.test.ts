import { describe, expect, test } from 'vitest';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { canonicalBytes, canonicalJson, isAuthoringCue, projectTrajectorySelection, projectTransformTrajectory,
  type CueSemantic, type HistoryOperation, type MotionDocument, type OperationIntentPayload } from '../../domain/src/index.ts';
import { MotionServiceClient, makeClaimAcquireCommand, makeOperationIntentCommand,
  makeTrackCreateCommand, makeTrajectoryCommand } from '../../motion-protocol/src/index.ts';
import { runCli } from '../../motion-cli/src/cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { createTrajectorySeed } from '../../local-service/src/seed.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

describe('CLI/editor protocol parity', () => {
  test('derives byte-identical sanitized intent commands for human and claimed-agent dispatch', async () => {
    const seed = createTrajectorySeed(); const humanTemporary = await temporaryStore(); const agentTemporary = await temporaryStore();
    const humanService = await startLocalMotionService({ databasePath: humanTemporary.databasePath, seed });
    const agentService = await startLocalMotionService({ databasePath: agentTemporary.databasePath, seed });
    const claimProof = ['parity', 'agent', 'claim', 'proof', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const human = new MotionServiceClient(humanService.url); const agent = new MotionServiceClient(agentService.url,
      (...args) => fetch(...args), { actor: 'agent', capability: 'cli-agent', claimSecret: claimProof });
    expect(await agent.dispatch(makeClaimAcquireCommand({ operationId: 'parity-intent-claim', documentId: seed.documentId,
      expectedRevision: 0, scope: 'document' }))).toMatchObject({ ok: true });
    const ids = seed.elements.map((element) => element.id).sort(); const request = {
      schemaVersion: 'motion.operation-preparation-request.v1' as const, documentId: seed.documentId, branchId: 'main',
      expectedRevision: 0, kind: 'motion.transform-waypoints.translate' as const, intent: {
        kind: 'motion.transform-waypoints.translate' as const, elementIds: ids, momentMs: 700,
        deltaXPpm: 10_000, deltaYPpm: -10_000, viewport: { widthCssPixels: 800, heightCssPixels: 450 },
      } };
    const humanPreparation = await human.prepareOperation(request); const agentPreparation = await agent.prepareOperation(request);
    expect(canonicalJson(humanPreparation)).toBe(canonicalJson(agentPreparation));
    const command = makeOperationIntentCommand({ schemaVersion: 'motion.operation-intent.v1', operationId: 'parity-intent',
      documentId: seed.documentId, expectedRevision: 0, kind: humanPreparation.kind,
      derivationDigest: humanPreparation.derivationDigest!, intent: humanPreparation.normalizedIntent! });
    const [humanResponse, agentResponse] = await Promise.all([human.dispatch(command), agent.dispatch(command)]);
    expect(canonicalJson(humanResponse)).toBe(canonicalJson(agentResponse));
    const [humanHead, agentHead] = await Promise.all([human.head(seed.documentId), agent.head(seed.documentId)]);
    expect(canonicalBytes(humanHead.document)).toEqual(canonicalBytes(agentHead.document));
    expect(compileMotionDocument(humanHead.document)).toEqual(compileMotionDocument(agentHead.document));
    await humanService.close(); await agentService.close(); await humanTemporary.cleanup(); await agentTemporary.cleanup();
  });
  test('produces byte-identical cue wires, documents, compiler output, and receipts from equal bases', async () => {
    const seed = phase3Seed(); const cliTemporary = await temporaryStore(); const editorTemporary = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: cliTemporary.databasePath, seed });
    const editorService = await startLocalMotionService({ databasePath: editorTemporary.databasePath, seed });
    const originalFetch = globalThis.fetch; const cliWires = wireRecord(); const editorWires = wireRecord();
    const recordingFetch = (wires: WireRecord): typeof fetch => async (input, init) => {
      const url = String(input);
      if (url.endsWith('/operations/prepare')) wires.preparations.push(String(init?.body ?? ''));
      if (url.endsWith('/api/v1/commands')) wires.commands.push(String(init?.body ?? ''));
      return originalFetch(input, init);
    };
    globalThis.fetch = recordingFetch(cliWires); const editorClient = new MotionServiceClient(editorService.url,
      recordingFetch(editorWires)); const cliClient = new MotionServiceClient(cliService.url, originalFetch);
    const targetId = seed.elements[0]!.id;
    const runCue = async (name: 'cue-create' | 'cue-update' | 'cue-delete' | 'cue-detach', revision: number,
      intent: OperationIntentPayload, args: string[]) => {
      const operationId = `parity-${name}-${revision}`; let cliOutput = '';
      expect(await runCli([name, '--service', cliService.url, '--operation-id', operationId,
        '--document-id', seed.documentId, '--expected-revision', String(revision), ...args],
      { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
      const editorResponse = await dispatchPrepared(editorClient, seed.documentId, revision, operationId, intent);
      expect(cliOutput).toBe(canonicalJson(editorResponse));
      expect(cliWires.preparations.at(-1)).toBe(editorWires.preparations.at(-1));
      expect(cliWires.commands.at(-1)).toBe(editorWires.commands.at(-1));
      const cliHead = await cliClient.head(seed.documentId); const editorHead = await editorClient.head(seed.documentId);
      expect(canonicalBytes(cliHead.document)).toEqual(canonicalBytes(editorHead.document));
      expect(compileMotionDocument(cliHead.document)).toEqual(compileMotionDocument(editorHead.document));
      return cliHead.document;
    };
    try {
      const createSemantic: CueSemantic = { kind: 'reveal', targetIds: [targetId], startMs: 100, completeMs: 500 };
      const created = await runCue('cue-create', 0, { kind: 'motion.cue.create', creationKey: 'parity-reveal',
        semantic: createSemantic }, ['--creation-key', 'parity-reveal', '--semantic', 'reveal', '--target-id', targetId,
        '--start-ms', '100', '--complete-ms', '500']);
      const cue = created.cues.find((candidate) => isAuthoringCue(candidate) && candidate.semantic.kind === 'reveal'
        && candidate.semantic.completeMs === 500); if (!cue || !isAuthoringCue(cue)) throw new Error('PARITY_CUE_MISSING');
      const updatedSemantic: CueSemantic = { ...createSemantic, startMs: 120, completeMs: 600 };
      await runCue('cue-update', 1, { kind: 'motion.cue.update', cueId: cue.id, semantic: updatedSemantic },
        ['--cue-id', cue.id, '--semantic', 'reveal', '--target-id', targetId, '--start-ms', '120', '--complete-ms', '600']);
      await runCue('cue-delete', 2, { kind: 'motion.cue.delete', cueId: cue.id }, ['--cue-id', cue.id]);
      const detachedSemantic: CueSemantic = { kind: 'reveal', targetIds: [targetId], startMs: 200, completeMs: 700 };
      const detachedBase = await runCue('cue-create', 3, { kind: 'motion.cue.create', creationKey: 'parity-detach',
        semantic: detachedSemantic }, ['--creation-key', 'parity-detach', '--semantic', 'reveal', '--target-id', targetId,
        '--start-ms', '200', '--complete-ms', '700']);
      const detachable = detachedBase.cues.find((candidate) => isAuthoringCue(candidate)
        && candidate.semantic.kind === 'reveal' && candidate.semantic.completeMs === 700);
      if (!detachable || !isAuthoringCue(detachable)) throw new Error('PARITY_DETACH_CUE_MISSING');
      await runCue('cue-detach', 4, { kind: 'motion.cue.detach', cueId: detachable.id }, ['--cue-id', detachable.id]);
      expect(cliWires.preparations).toHaveLength(5); expect(editorWires.preparations).toHaveLength(5);
      expect(cliWires.commands).toHaveLength(5); expect(editorWires.commands).toHaveLength(5);
    } finally {
      globalThis.fetch = originalFetch; await cliService.close(); await editorService.close();
      await cliTemporary.cleanup(); await editorTemporary.cleanup();
    }
  });
  test('produces byte-identical documents, native compiler output, digests, and receipts from identical bases', async () => {
    const seed = phase3Seed(); const cliTemporary = await temporaryStore(); const editorTemporary = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: cliTemporary.databasePath, seed });
    const editorService = await startLocalMotionService({ databasePath: editorTemporary.databasePath, seed });
    const shared = { operationId: 'parity-operation', documentId: seed.documentId, expectedRevision: seed.revision,
      elementId: 'el_2dbee68b1ea318c8' as const };
    let cliOutput = '';
    expect(await runCli(['track-create', '--service', cliService.url, '--operation-id', shared.operationId,
      '--document-id', shared.documentId, '--expected-revision', '0', '--element-id', shared.elementId],
    { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
    const editorResponse = await new MotionServiceClient(editorService.url).dispatch(makeTrackCreateCommand(shared));
    expect(JSON.parse(cliOutput)).toEqual(editorResponse);
    const cliHead = await new MotionServiceClient(cliService.url).head(seed.documentId);
    const editorHead = await new MotionServiceClient(editorService.url).head(seed.documentId);
    expect(canonicalBytes(cliHead.document)).toEqual(canonicalBytes(editorHead.document));
    expect(compileMotionDocument(cliHead.document)).toEqual(compileMotionDocument(editorHead.document));
    await cliService.close(); await editorService.close(); await cliTemporary.cleanup(); await editorTemporary.cleanup();
  });

  test('uses byte-identical CLI and editor commands for five trajectory mutations plus Undo and Redo', async () => {
    const seed = createTrajectorySeed(); const cliTemporary = await temporaryStore(); const editorTemporary = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: cliTemporary.databasePath, seed });
    const editorService = await startLocalMotionService({ databasePath: editorTemporary.databasePath, seed });
    const originalFetch = globalThis.fetch; const cliWires = wireRecord(); const editorWires = wireRecord();
    const recordingFetch = (wires: WireRecord): typeof fetch => async (input, init) => {
      const url = String(input);
      if (url.endsWith('/operations/prepare')) wires.preparations.push(String(init?.body ?? ''));
      if (url.endsWith('/api/v1/commands')) wires.commands.push(String(init?.body ?? ''));
      return originalFetch(input, init);
    };
    globalThis.fetch = recordingFetch(cliWires);
    const editorClient = new MotionServiceClient(editorService.url, recordingFetch(editorWires));
    try {
      const ids = seed.elements.map((element) => element.id).sort(); const stage = {
        stageDigest: 'a'.repeat(64), widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 };
      const cliNames = ['pose-set', 'waypoints-translate', 'moment-time-set', 'segment-easing-set', 'settled-hold-set'] as const;
      for (let revision = 0; revision < cliNames.length; revision += 1) {
        const head = await editorClient.head(seed.documentId); const operation = trajectoryIntent(head.document, revision, ids, stage);
        let cliOutput = '';
        expect(await runCli([cliNames[revision]!, '--service', cliService.url, '--operation-id', operation.operationId,
          '--document-id', seed.documentId, '--expected-revision', String(revision), ...operation.args],
        { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
        const editorResponse = await dispatchPrepared(editorClient, seed.documentId, revision, operation.operationId,
          operation.intent);
        expect(JSON.parse(cliOutput)).toEqual(editorResponse);
        expect(cliWires.preparations.at(-1)).toBe(editorWires.preparations.at(-1));
        expect(cliWires.commands.at(-1)).toBe(editorWires.commands.at(-1));
        const cliHead = await new MotionServiceClient(cliService.url, originalFetch).head(seed.documentId);
        const editorHead = await editorClient.head(seed.documentId);
        expect(canonicalBytes(cliHead.document)).toEqual(canonicalBytes(editorHead.document));
        expect(compileMotionDocument(cliHead.document)).toEqual(compileMotionDocument(editorHead.document));
      }
      for (const [name, expectedRevision] of [['undo', 5], ['redo', 6]] as const) {
        const operation: HistoryOperation = { schemaVersion: 'motion.operation.v1', kind: `motion.history.${name}`,
          operationId: `parity-${name}`, documentId: seed.documentId, expectedRevision };
        let cliOutput = '';
        expect(await runCli([name, '--service', cliService.url, '--operation-id', operation.operationId,
          '--document-id', seed.documentId, '--expected-revision', String(expectedRevision)],
        { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
        const editorResponse = await editorClient.dispatch(makeTrajectoryCommand(operation));
        expect(JSON.parse(cliOutput)).toEqual(editorResponse);
        expect(cliWires.commands.at(-1)).toBe(editorWires.commands.at(-1));
      }
      expect(cliWires.preparations).toHaveLength(5); expect(editorWires.preparations).toHaveLength(5);
      expect(cliWires.commands).toHaveLength(7); expect(editorWires.commands).toHaveLength(7);
    } finally {
      globalThis.fetch = originalFetch;
      await cliService.close(); await editorService.close(); await cliTemporary.cleanup(); await editorTemporary.cleanup();
    }
  });
});

function trajectoryIntent(document: MotionDocument, revision: number, ids: string[], _stage: {
  stageDigest: string; widthMicrounits: number; heightMicrounits: number }): {
    operationId: string; intent: OperationIntentPayload; args: string[] } {
  const operationId = `parity-trajectory-${revision}`;
  if (revision === 0) {
    const selected = projectTrajectorySelection(document, [ids[0]!], 700); const trajectory = projectTransformTrajectory(document, ids[0]!);
    if (!selected.eligible || !trajectory.eligible) throw new Error('PARITY_POSE_UNAVAILABLE');
    const current = trajectory.waypoints.find((point) => point.timeMs === 700); if (!current) throw new Error('PARITY_POSE_MISSING');
    const pose = { ...current.pose, scalePpm: current.pose.scalePpm + 100_000 };
    return { operationId, intent: { kind: 'motion.transform-pose.set', elementId: ids[0]!, momentMs: 700, pose,
      viewport: { widthCssPixels: 800, heightCssPixels: 450 } }, args: ['--element-id', ids[0]!, '--moment-ms', '700',
      '--translate-x-microunits', String(pose.translateXMicrounits), '--translate-y-microunits', String(pose.translateYMicrounits),
      '--scale-ppm', String(pose.scalePpm), '--rotate-microdegrees', String(pose.rotateMicrodegrees),
      '--viewport-width', '800', '--viewport-height', '450'] };
  }
  const moment = revision < 3 ? 700 : revision === 3 ? 840 : 2100;
  const selected = projectTrajectorySelection(document, ids, moment); if (!selected.eligible) throw new Error(selected.code!);
  const elementArgs = ids.flatMap((id) => ['--element-id', id]);
  if (revision === 1) return { operationId, intent: { kind: 'motion.transform-waypoints.translate', elementIds: ids,
    momentMs: 700, deltaXPpm: 10_000, deltaYPpm: -10_000, viewport: { widthCssPixels: 800, heightCssPixels: 450 } },
    args: [...elementArgs, '--moment-ms', '700', '--delta-x-ppm', '10000', '--delta-y-ppm', '-10000',
      '--viewport-width', '800', '--viewport-height', '450'] };
  if (revision === 2) return { operationId, intent: { kind: 'motion.keyframe-group-time.set', elementIds: ids,
    sourceTimeMs: 700, targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 }, args: [...elementArgs,
      '--source-time-ms', '700', '--target-time-ms', '840', '--landing-time-ms', '840', '--settled-time-ms', '2100'] };
  if (revision === 3) return { operationId, intent: { kind: 'motion.keyframe-group-easing.set', elementIds: ids,
    momentMs: 840, expectedEasing: { kind: 'keyword', value: 'ease-out' },
    easing: { kind: 'keyword', value: 'ease-in-out' } }, args: [...elementArgs, '--moment-ms', '840',
      '--expected-easing', 'keyword:ease-out', '--easing', 'keyword:ease-in-out'] };
  return { operationId, intent: { kind: 'motion.settled-hold.set', elementIds: ids, sourceTimeMs: 2100,
    settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 }, args: [...elementArgs,
      '--source-time-ms', '2100', '--settled-time-ms', '1820', '--landing-time-ms', '840', '--boundary-time-ms', '2100'] };
}

type WireRecord = { preparations: string[]; commands: string[] };
function wireRecord(): WireRecord { return { preparations: [], commands: [] }; }

async function dispatchPrepared(client: MotionServiceClient, documentId: string, expectedRevision: number,
  operationId: string, intent: OperationIntentPayload) {
  const prepared = await client.prepareOperation({ schemaVersion: 'motion.operation-preparation-request.v1', documentId,
    branchId: 'main', expectedRevision, kind: intent.kind, intent });
  if (!prepared.eligibility || !prepared.normalizedIntent || !prepared.derivationDigest)
    throw new Error(prepared.reasonCode ?? 'PARITY_PREPARATION_INELIGIBLE');
  return client.dispatch(makeOperationIntentCommand({ schemaVersion: 'motion.operation-intent.v1', operationId,
    documentId, expectedRevision, kind: prepared.kind, derivationDigest: prepared.derivationDigest,
    intent: prepared.normalizedIntent }));
}
