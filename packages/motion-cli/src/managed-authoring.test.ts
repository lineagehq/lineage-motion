import { expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { createPhase3Seed } from '../../local-service/src/seed.ts';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnTestServer, stopTestServer, waitForTestServer } from '../../../apps/editor/tests/test-server.ts';
import { checkout, fixture, invoke, readCredential } from './managed-test-support.ts';
import { sessionPath } from './session-context.ts';

// All authoring inputs come from shipped help and public CLI responses. Reading private
// files below is solely the final no-secret-output assertion, never workflow setup.
test('normal managed launch supports help-driven discovery, admission, claimed edits and restart recovery', async () => {
  const f = await fixture(); const outputs: string[] = [];
  const launch = () => spawnTestServer(process.execPath, ['--import', 'tsx', join(checkout, 'apps/editor/scripts/dev-editor.mjs'),
    '--project', f.project, '--data-dir', f.dataDir, '--port', '0'], { cwd: checkout, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let app = launch();
  const run = async (args: string[], code = 0) => {
    const result = await invoke([...args, '--data-dir', f.dataDir]); outputs.push(result.stdout + result.stderr);
    expect(result.code, result.stdout).toBe(code); expect(result.stderr).toBe(''); return result.json;
  };
  try {
    await waitForTestServer(app);
    const help = (await invoke(['help'])).json;
    const example = (name: string, values: Record<string, string | number> = {}) =>
      (help.examples[name] as string[]).map((arg) => arg.replace(/\{([^}]+)\}/g, (_match, key: string) => String(values[key])));
    expect((await run(example('context'))).project).toBe(f.project);
    const catalog = await run(example('project'));
    expect(catalog.name).toBe(f.project); expect(catalog.shots.length).toBe(1);
    const documentId = catalog.shots[0].documentId;
    const workspace = await run(example('workspace', { documentId }));
    const target = workspace.elements.find((element: any) => element.actions.some((action: any) => action.action === 'fade' && action.available));
    expect(target.label.length).toBeGreaterThan(0);
    const claim = await run(example('acquire', { documentId, revision: workspace.revision }));
    expect(claim.leaseVersion).toBe(1);
    const editValues = { documentId, elementId: target.elementId, revision: workspace.revision };
    expect((await run(example('create', editValues))).valid).toBe(true);
    expect((await run(example('workspace', { documentId }))).revision).toBe(0);
    expect((await run(example('edit', editValues))).resultingRevision).toBe(1);
    const renewed = await run(example('renew', { documentId, revision: 1, leaseVersion: claim.leaseVersion }));
    expect((await run(example('release', { documentId, revision: 1, leaseVersion: renewed.leaseVersion }))).ok).toBe(true);

    const admitArgs = example('admit', { projectId: catalog.projectId, catalogRevision: catalog.catalogRevision });
    const admission = await run(admitArgs);
    expect(admission).toMatchObject({ ok: true, documentId: 'agent_intro', claim: { leaseVersion: 1 }, inventory: { unsupportedCount: 0, missingCount: 0 } });
    expect(await run(admitArgs)).toEqual(admission);
    const shot = await run(['workspace', '--shot', admission.name]);
    const fade = shot.elements.find((element: any) => element.actions.some((action: any) => action.action === 'fade' && action.available));
    expect(fade).toBeDefined();
    const edit = ['track-create', '--document-id', admission.documentId, '--claim', 'intro', '--element-id', fade.elementId,
      '--operation-id', 'short-fade', '--expected-revision', '0', '--duration-seconds', '0.25', '--delay-seconds', '0.125',
      '--start-value', '0.08', '--end-value', '0.9'];
    expect((await run([...edit, '--validate-only'])).valid).toBe(true);
    expect((await run(edit)).resultingRevision).toBe(1);
    const edited = await run(['workspace', '--document-id', admission.documentId]);
    expect(edited.slots).toEqual(expect.arrayContaining([expect.objectContaining({ durationMs: 250, delayMs: 125 })]));
    const cue = edited.cues.find((candidate: any) => candidate.semantic === null && candidate.timeMs > 0 && candidate.timeMs < edited.durationMs);
    expect(cue).toBeDefined();
    expect((await run(['hold-insert', '--document-id', admission.documentId, '--claim', 'intro', '--cue-id', cue.cueId,
      '--duration-seconds', '0.43', '--operation-id', 'whole-pause', '--expected-revision', '1'])).resultingRevision).toBe(2);
    const held = await run(['head', '--document-id', admission.documentId]);
    expect(held.durationMs).toBe(edited.durationMs + 430);
    expect(held.holds).toEqual([expect.objectContaining({ cueId: cue.cueId, sourceTimeMs: cue.timeMs, durationMs: 430 })]);
    expect((await run(['undo', '--document-id', admission.documentId, '--claim', 'intro', '--operation-id', 'undo-pause', '--expected-revision', '2'])).resultingRevision).toBe(3);
    expect((await run(['head', '--document-id', admission.documentId])).durationMs).toBe(edited.durationMs);

    const nextCatalog = await run(['project']);
    const duplicate = await run(['shot-admit', '--project-id', nextCatalog.projectId, '--expected-catalog-revision', String(nextCatalog.catalogRevision),
      '--document-id', 'intro_copy', '--name', admission.name, '--starter', 'trajectory', '--claim', 'copy', '--operation-id', 'admit-copy']);
    expect(duplicate.ok).toBe(true);
    expect((await run(['head', '--shot', admission.name], 2)).diagnostic.code).toBe('CLI_SHOT_AMBIGUOUS');
    expect((await run(['head', '--document-id', admission.documentId])).revision).toBe(3);
    const beforeInvalid = await run(['project']);
    const invalidPath = join(f.directory, 'unsupported.html'); await writeFile(invalidPath, '<script>synthetic-source-sentinel</script>');
    expect(await run(['shot-admit', '--project-id', beforeInvalid.projectId, '--expected-catalog-revision', String(beforeInvalid.catalogRevision),
      '--document-id', 'invalid_shot', '--name', 'Rejected', '--html-file', invalidPath, '--claim', 'invalid', '--operation-id', 'invalid-import'], 2))
      .toMatchObject({ ok: false, code: 'IMPORT_REJECTED', inventory: expect.any(Object) });
    expect(await run(['project'])).toEqual(beforeInvalid);

    const sessionFile = sessionPath(f.project, f.dataDir);
    const session = JSON.parse(await readFile(sessionFile, 'utf8')); const secret = (await readCredential(sessionFile, 'intro')).secret;
    expect(outputs.join('')).not.toContain(session.agentCapability); expect(outputs.join('')).not.toContain(secret);
    expect(outputs.join('')).not.toContain('synthetic-source-sentinel'); expect(outputs.join('')).not.toContain(f.directory);
    expect((await run(['claim-release', '--document-id', admission.documentId, '--claim', 'intro', '--operation-id', 'release-intro',
      '--expected-revision', '3', '--lease-version', '1'])).ok).toBe(true);
    await stopTestServer(app); app = launch(); await waitForTestServer(app);
    expect((await run(['head', '--document-id', admission.documentId])).revision).toBe(3);
    expect((await run(['undo', '--document-id', admission.documentId, '--claim', 'intro', '--operation-id', 'stale-session', '--expected-revision', '3'], 2)).diagnostic.code)
      .toBe('CLI_SESSION_CHANGED');
    const recovered = await run(['claim-acquire', '--document-id', admission.documentId, '--claim', 'after_restart',
      '--scope', 'document', '--operation-id', 'restart-acquire', '--expected-revision', '3']);
    expect(recovered.ok).toBe(true);
    expect((await run(['claim-release', '--document-id', admission.documentId, '--claim', 'after_restart', '--operation-id', 'restart-release',
      '--expected-revision', '3', '--lease-version', String(recovered.leaseVersion)])).ok).toBe(true);
  } finally { await stopTestServer(app); await f.cleanup(); }
}, 40_000);

test('normal CLI reopens an older saved project by preserved catalog identity and edits its saved revision', async () => {
  const f = await fixture();
  const capabilities = { human: randomBytes(32).toString('base64url'), agent: f.capability };
  // Reproduce a database created before the managed launcher supplied project identity.
  const databasePath = join(dirname(sessionPath(f.project, f.dataDir)), 'project.sqlite');
  const oldService = await startLocalMotionService({ databasePath, seed: createPhase3Seed(checkout), capabilities });
  let app: ReturnType<typeof spawnTestServer> | undefined;
  try {
    const oldProject = new ProjectServiceClient(oldService.url, { actor: 'human', capability: capabilities.human });
    const original = await oldProject.catalog(); expect(original.name).toBe('My animation');
    expect(original.name).not.toBe(f.project);
    const human = new MotionServiceClient(oldService.url, fetch, { actor: 'human', capability: capabilities.human });
    const documentId = original.shots[0]!.documentId;
    const initial = await human.workspace(documentId, 'main');
    const target = initial.elements.find((element) => element.actions.some((action) => action.action === 'fade' && action.available))!;
    expect(await human.dispatch(makeTrackCreateCommand({ operationId: 'saved-before-upgrade', documentId, expectedRevision: 0,
      elementId: target.elementId }))).toMatchObject({ ok: true, resultingRevision: 1 });
    const saved = await oldProject.catalog(); await oldService.close();
    app = spawnTestServer(process.execPath, ['--import', 'tsx', join(checkout, 'apps/editor/scripts/dev-editor.mjs'),
      '--project', f.project, '--data-dir', f.dataDir, '--port', '0'], { cwd: checkout, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForTestServer(app);
    const help = (await invoke(['help'])).json;
    const run = async (args: string[]) => {
      const result = await invoke([...args, '--data-dir', f.dataDir]);
      expect(result.code, result.stdout).toBe(0); expect(result.stderr).toBe(''); return result.json;
    };
    const context = await run(help.examples.context);
    expect(context).toMatchObject({ project: f.project, projectId: original.projectId });
    expect(await run(help.examples.project)).toEqual(saved);
    // No document ID is needed here: the catalog resolves its one saved shot using actual project ID.
    expect(await run(['workspace'])).toMatchObject({ documentId, revision: 1, canonicalDigest: saved.shots[0]!.canonicalDigest });
    const acquire = (help.examples.acquire as string[]).map((arg) => arg.replace('{documentId}', documentId).replace('{revision}', '1'));
    const claim = await run(acquire); expect(claim.ok).toBe(true);
    expect(await run(['undo', '--document-id', documentId, '--claim', 'edit', '--operation-id', 'edit-after-upgrade', '--expected-revision', '1']))
      .toMatchObject({ ok: true, resultingRevision: 2 });
    const after = await run(['project']);
    expect(after).toMatchObject({ projectId: original.projectId, name: original.name, shots: [expect.objectContaining({ documentId, headRevision: 2 })] });
    const release = (help.examples.release as string[]).map((arg) => arg.replace('{documentId}', documentId).replace('{revision}', '2').replace('{leaseVersion}', String(claim.leaseVersion)));
    expect((await run(release)).ok).toBe(true);
  } finally { await oldService.close(); if (app) await stopTestServer(app); await f.cleanup(); }
}, 25_000);
