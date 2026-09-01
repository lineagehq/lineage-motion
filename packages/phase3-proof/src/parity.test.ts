import { describe, expect, test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { canonicalBytes, canonicalJson, cueTargetSnapshots, deriveCueId, projectCueReplacement,
  projectTrajectorySelection, projectTransformTrajectory, type CueAuthoringOperation, type CueSemantic,
  type HistoryOperation, type MotionDocument, type TrajectoryAuthoringOperation } from '../../domain/src/index.ts';
import { MotionServiceClient, makeCueCommand, makeTrackCreateCommand, makeTrajectoryCommand } from '../../motion-protocol/src/index.ts';
import { runCli } from '../../motion-cli/src/cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { createTrajectorySeed } from '../../local-service/src/seed.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

describe('CLI/editor protocol parity', () => {
  test('produces byte-identical cue wires, documents, compiler output, and receipts from equal bases', async () => {
    const seed = phase3Seed(); const cliTemporary = await temporaryStore(); const editorTemporary = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: cliTemporary.databasePath, seed });
    const editorService = await startLocalMotionService({ databasePath: editorTemporary.databasePath, seed });
    const semantic: CueSemantic = { kind: 'reveal', targetIds: [seed.elements[0]!.id], startMs: 100, completeMs: 500 };
    const cueId = deriveCueId(seed.documentId, 'parity-reveal'); const replacement = projectCueReplacement(seed, cueId, semantic);
    expect(replacement.ok).toBe(true); if (!replacement.ok) throw new Error(replacement.code);
    const operation: CueAuthoringOperation = { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.create',
      operationId: 'parity-cue', documentId: seed.documentId, expectedRevision: 0, payload: { cueId, semantic,
        targetSnapshots: cueTargetSnapshots(seed, semantic), replacementTrackIds: replacement.trackIds,
        replacementInputDigest: replacement.inputDigest } };
    const bundlePath = join(cliTemporary.directory, 'cue.json'); await writeFile(bundlePath, JSON.stringify(operation), { mode: 0o600 });
    let cliOutput = ''; expect(await runCli(['cue-create', '--service', cliService.url, '--operation-id', operation.operationId,
      '--document-id', seed.documentId, '--expected-revision', '0', '--bundle', bundlePath],
    { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
    const editorResponse = await new MotionServiceClient(editorService.url).dispatch(makeCueCommand(operation));
    expect(cliOutput).toBe(canonicalJson(editorResponse));
    const cliHead = await new MotionServiceClient(cliService.url).head(seed.documentId);
    const editorHead = await new MotionServiceClient(editorService.url).head(seed.documentId);
    expect(canonicalBytes(cliHead.document)).toEqual(canonicalBytes(editorHead.document));
    expect(compileMotionDocument(cliHead.document)).toEqual(compileMotionDocument(editorHead.document));
    await cliService.close(); await editorService.close(); await cliTemporary.cleanup(); await editorTemporary.cleanup();
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
    const originalFetch = globalThis.fetch; const cliWires: string[] = []; const editorWires: string[] = [];
    const recordingFetch = (wires: string[]): typeof fetch => async (input, init) => {
      if (String(input).endsWith('/api/v1/commands')) wires.push(String(init?.body ?? ''));
      return originalFetch(input, init);
    };
    globalThis.fetch = recordingFetch(cliWires);
    const editorClient = new MotionServiceClient(editorService.url, recordingFetch(editorWires));
    try {
      const ids = seed.elements.map((element) => element.id).sort(); const stage = {
        stageDigest: 'a'.repeat(64), widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 };
      const cliNames = ['pose-set', 'waypoints-translate', 'moment-time-set', 'segment-easing-set', 'settled-hold-set'] as const;
      for (let revision = 0; revision < cliNames.length; revision += 1) {
        const head = await editorClient.head(seed.documentId); const operation = trajectoryOperation(head.document, revision, ids, stage);
        const bundlePath = join(cliTemporary.directory, `trajectory-${revision}.json`); await writeFile(bundlePath, JSON.stringify(operation), { mode: 0o600 });
        let cliOutput = '';
        expect(await runCli([cliNames[revision]!, '--service', cliService.url, '--operation-id', operation.operationId,
          '--document-id', seed.documentId, '--expected-revision', String(revision), '--bundle', bundlePath],
        { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
        const editorResponse = await editorClient.dispatch(makeTrajectoryCommand(operation));
        expect(JSON.parse(cliOutput)).toEqual(editorResponse);
        expect(cliWires.at(-1)).toBe(editorWires.at(-1));
        expect(cliWires.at(-1)).toBe(canonicalJson(makeTrajectoryCommand(operation)));
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
        expect(cliWires.at(-1)).toBe(editorWires.at(-1));
        expect(cliWires.at(-1)).toBe(canonicalJson(makeTrajectoryCommand(operation)));
      }
      expect(cliWires).toHaveLength(7); expect(editorWires).toHaveLength(7);
    } finally {
      globalThis.fetch = originalFetch;
      await cliService.close(); await editorService.close(); await cliTemporary.cleanup(); await editorTemporary.cleanup();
    }
  });
});

function trajectoryOperation(document: MotionDocument, revision: number, ids: string[], stage: {
  stageDigest: string; widthMicrounits: number; heightMicrounits: number }): TrajectoryAuthoringOperation {
  const envelope = { schemaVersion: 'motion.operation.v1' as const, operationId: `parity-trajectory-${revision}`,
    documentId: document.documentId, expectedRevision: revision };
  if (revision === 0) {
    const selected = projectTrajectorySelection(document, [ids[0]!], 700); const trajectory = projectTransformTrajectory(document, ids[0]!);
    if (!selected.eligible || !trajectory.eligible) throw new Error('PARITY_POSE_UNAVAILABLE');
    const current = trajectory.waypoints.find((point) => point.timeMs === 700); if (!current) throw new Error('PARITY_POSE_MISSING');
    return { ...envelope, kind: 'motion.transform-pose.set', ...selected.targets[0]!,
      payload: { pose: { ...current.pose, scalePpm: current.pose.scalePpm + 100_000 }, stage } };
  }
  const moment = revision < 3 ? 700 : revision === 3 ? 840 : 2100;
  const selected = projectTrajectorySelection(document, ids, moment); if (!selected.eligible) throw new Error(selected.code!);
  if (revision === 1) return { ...envelope, kind: 'motion.transform-waypoints.translate',
    payload: { targets: selected.targets, deltaXPpm: 10_000, deltaYPpm: -10_000, stage } };
  if (revision === 2) return { ...envelope, kind: 'motion.keyframe-group-time.set',
    payload: { targets: selected.targets, sourceTimeMs: 700, targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 } };
  if (revision === 3) return { ...envelope, kind: 'motion.keyframe-group-easing.set', payload: { targets: selected.targets,
    expectedEasing: { kind: 'keyword', value: 'ease-out' }, easing: { kind: 'keyword', value: 'ease-in-out' } } };
  return { ...envelope, kind: 'motion.settled-hold.set', payload: { targets: selected.targets,
    sourceTimeMs: 2100, settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 } };
}
