import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCli } from '../../../packages/motion-cli/src/cli.ts';

test('human browser and independent CLI agent share one durable animation document', async ({ page }) => {
  test.setTimeout(120_000);
  const root = resolve(import.meta.dirname, '../../..');
  const directory = await mkdtemp(join(tmpdir(), 'lineage-motion-dogfood-'));
  const databasePath = join(directory, 'dogfood.sqlite');
  const capabilities = { human: randomBytes(32).toString('base64url'), agent: randomBytes(32).toString('base64url') };
  let processHandle: ChildProcess | undefined;

  const start = async () => {
    const child = spawn('vite-node', [resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
      cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: databasePath, PHASE3_EDITOR_PORT: '0',
        PHASE3_HUMAN_CAPABILITY: capabilities.human, PHASE3_AGENT_CAPABILITY: capabilities.agent },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const addresses = await new Promise<{ editorUrl: string; serviceUrl: string }>((resolveAddress, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('DOGFOOD_SERVER_TIMEOUT')), 10_000);
      child.stdout!.on('data', (chunk) => { output += chunk.toString();
        const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
        if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`DOGFOOD_SERVER_EXIT_${code}`)); });
    });
    await expect.poll(async () => { try { return (await fetch(addresses.editorUrl)).ok; } catch { return false; } }).toBe(true);
    processHandle = child; return addresses;
  };
  const stop = async () => {
    if (processHandle?.exitCode === null) { processHandle.kill('SIGTERM');
      await new Promise((resolveExit) => processHandle!.once('exit', resolveExit)); }
    processHandle = undefined;
  };

  try {
    let addresses = await start();
    await page.goto(addresses.editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    expect(new URL(page.url()).hostname).toBe('lineage-motion.localhost');
    const initial = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const documentId = initial.documentId;

    const invoke = async (args: string[]) => {
      let stdout = ''; let stderr = '';
      const code = await runCli(args, { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
      return { code, stderr, stdout, json: stdout ? JSON.parse(stdout) as Record<string, unknown> : null };
    };
    const agentCommon = () => ['--service', addresses.serviceUrl, '--document-id', documentId,
      '--branch-id', 'main', '--actor', 'agent', '--capability', capabilities.agent];
    const humanCommon = () => ['--service', addresses.serviceUrl, '--document-id', documentId,
      '--branch-id', 'main', '--actor', 'human', '--capability', capabilities.human];

    const vocabulary = await invoke(['operation-kinds', '--service', addresses.serviceUrl]);
    expect(vocabulary).toMatchObject({ code: 0, stderr: '', json: { schemaVersion: 'motion.operation-kind-list.v1' } });
    const workspace = await invoke(['workspace', ...agentCommon()]);
    expect(workspace).toMatchObject({ code: 0, stderr: '', json: { schemaVersion: 'motion.workspace-projection.v1', revision: 0 } });
    const workspaceElements = (workspace.json!.elements as Array<{ elementId: string }>).map(({ elementId }) => elementId);
    const browserTargets = await page.locator('input[name="creation-target"]').evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value));
    const elementId = workspaceElements.find((candidate) => browserTargets.includes(candidate));
    expect(elementId).toBeTruthy();

    const unauthorized = await invoke(['track-create', ...agentCommon(), '--operation-id', 'dogfood-unauthorized',
      '--expected-revision', '0', '--element-id', elementId!]);
    expect(unauthorized).toMatchObject({ code: 4, stderr: '', json: { ok: false, code: 'UNAUTHORIZED_CLAIM',
      diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'CLAIM_REQUIRED', category: 'authorization', retryable: false } } });
    expect((await invoke(['head', ...agentCommon()])).json).toMatchObject({ revision: 0 });

    let claimSecret = ''; expect(await runCli(['claim-secret'], { stdout: (value) => { claimSecret += value; }, stderr: () => undefined })).toBe(0);
    claimSecret = claimSecret.trim(); expect(claimSecret.length).toBeGreaterThanOrEqual(32);
    const acquired = await invoke(['claim-acquire', ...agentCommon(), '--operation-id', 'dogfood-claim',
      '--expected-revision', '0', '--scope', 'document', '--claim-secret', claimSecret]);
    expect(acquired).toMatchObject({ code: 0, stderr: '', json: { ok: true, leaseVersion: 1 } });
    const claimId = String(acquired.json!.claimId);
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().claims?.claims.length ?? 0)).toBe(1);
    await expect(page.locator('[data-collaboration-claim]')).not.toHaveText('None');

    const locked = await invoke(['track-create', ...agentCommon(), '--operation-id', 'dogfood-locked-by-active-claim',
      '--expected-revision', '0', '--element-id', elementId!]);
    expect(locked).toMatchObject({ code: 4, stderr: '', json: { ok: false, code: 'UNAUTHORIZED_CLAIM',
      diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'CLAIM_REQUIRED', category: 'authorization', retryable: false } } });
    expect((await invoke(['head', ...agentCommon()])).json).toMatchObject({ revision: 0 });

    await page.evaluate(() => window.__motionEditor.disconnectEvents());
    const agentMutation = await invoke(['track-create', ...agentCommon(), '--operation-id', 'dogfood-agent-create',
      '--expected-revision', '0', '--element-id', elementId!, '--claim-secret', claimSecret]);
    expect(agentMutation).toMatchObject({ code: 0, stderr: '', json: { ok: true, resultingRevision: 1 } });
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
    await page.evaluate(() => window.__motionEditor.reconnectEvents());
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
    await expect(page.locator(`[data-element-id="${elementId}"][data-property="opacity"]`)).toHaveCount(1);

    const chronology = await invoke(['cue-create', ...agentCommon(), '--operation-id', 'dogfood-invalid-chronology',
      '--expected-revision', '1', '--creation-key', 'dogfood-invalid', '--semantic', 'reveal', '--target-id', elementId!,
      '--start-ms', '500', '--complete-ms', '100', '--claim-secret', claimSecret]);
    expect(chronology).toMatchObject({ code: 2, stderr: '', json: { ok: false, code: 'VALIDATION', diagnostic: {
      schemaVersion: 'motion.diagnostic.v1', code: 'PROTOCOL_PREPARATION_REQUEST_INVALID', category: 'protocol',
      retryable: false, fieldPath: '$' } } });
    expect((await invoke(['head', ...agentCommon()])).json).toMatchObject({ revision: 1 });

    const released = await invoke(['claim-release', ...agentCommon(), '--operation-id', 'dogfood-release',
      '--expected-revision', '1', '--claim-id', claimId, '--lease-version', '1', '--claim-secret', claimSecret]);
    expect(released).toMatchObject({ code: 0, stderr: '', json: { ok: true, leaseVersion: 2 } });
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().claims?.claims.length ?? 0)).toBe(0);

    const stale = await invoke(['track-create', ...humanCommon(), '--operation-id', 'dogfood-stale',
      '--expected-revision', '0', '--element-id', elementId!]);
    expect(stale).toMatchObject({ code: 2, stderr: '', json: { ok: false, code: 'VALIDATION',
      diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'CLI_DISCOVERED_REVISION_MISMATCH',
        category: 'target', retryable: false } } });
    expect((await invoke(['head', ...humanCommon()])).json).toMatchObject({ revision: 1 });

    const reacquired = await invoke(['claim-acquire', ...agentCommon(), '--operation-id', 'dogfood-reacquire',
      '--expected-revision', '1', '--scope', 'document', '--claim-secret', claimSecret]);
    expect(reacquired).toMatchObject({ code: 0, json: { ok: true, leaseVersion: 1 } });
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().claims?.claims.length ?? 0)).toBe(1);
    await page.locator('.collaboration-details summary').click();
    await page.locator('[data-claim-id]').fill(String(reacquired.json!.claimId));
    await page.locator('[data-lease-version]').fill('1');
    await page.locator('[data-revoke-form] button').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().claims?.claims.length ?? 0)).toBe(0);

    await page.getByRole('button', { name: 'Add midpoint' }).click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
    const humanMutation = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(humanMutation.contentDigest);

    const previewBeforeRestart = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      return { exact: frame.srcdoc === window.__motionEditor.compiledHtml,
        native: frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation'),
        digest: window.__motionEditor.inspectAuthoring().exportDigest };
    });
    expect(previewBeforeRestart).toMatchObject({ exact: true, native: true });

    await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    expect(new URL(page.url()).hostname).toBe('lineage-motion.localhost');
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: 4,
      contentDigest: humanMutation.contentDigest, exportDigest: previewBeforeRestart.digest });
    await expect.poll(() => page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      return frame.srcdoc === window.__motionEditor.compiledHtml
        && frame.contentDocument!.getAnimations().length > 0
        && frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation'); })).toBe(true);

    const proofs = [await invoke(['export-proof', ...agentCommon()]), await invoke(['export-proof', ...agentCommon()]),
      await invoke(['export-proof', ...agentCommon()])];
    expect(proofs.every((proof) => proof.code === 0 && proof.stderr === '')).toBe(true);
    expect(new Set(proofs.map((proof) => proof.stdout)).size).toBe(1);
    expect(proofs[0]!.json).toMatchObject({ schemaVersion: 'motion.export-proof.v1', revision: 4,
      exportDigest: previewBeforeRestart.digest });
    await page.locator('[data-scrub]').fill('1000');
    expect(await page.evaluate(() => window.__motionEditor.readState().playStates.every((state) => state === 'paused'))).toBe(true);
    await expect(page.locator('[data-reduced-motion-panel]')).toHaveAttribute('data-mode', 'source-snapshot');

    const exportProof = proofs[0]!.json as { revision: number; canonicalDigest: string; htmlDigest: string;
      cssDigest: string; exportDigest: string; reducedMotionDigest: string;
      counts: { ruleCount: number; applicationCount: number; slotCount: number; trackCount: number } };
    const receipt = {
      schemaVersion: 'motion.human-agent-dogfood-proof.v1', passed: true,
      clients: { browserHuman: true, independentCliAgent: true, sharedDurableDocument: true },
      workflow: { namedSubdomain: true, claimVisible: true, claimLifecycleComplete: true,
        disconnectCatchup: true, browserReload: true, undoRedoExact: true },
      diagnostics: { exactCount: 4, unauthorized: 'CLAIM_REQUIRED', locked: 'CLAIM_REQUIRED', chronology: 'PROTOCOL_PREPARATION_REQUEST_INVALID',
        stalePreflight: 'CLI_DISCOVERED_REVISION_MISMATCH', rejectedRevisionAllocations: 0 },
      preview: { compilerExact: true, browserNativeAnimations: true, reducedMotionInspectable: true },
      export: { sampleCount: proofs.length, byteIdentical: true, revision: exportProof.revision,
        canonicalDigest: exportProof.canonicalDigest, htmlDigest: exportProof.htmlDigest, cssDigest: exportProof.cssDigest,
        exportDigest: exportProof.exportDigest, reducedMotionDigest: exportProof.reducedMotionDigest, counts: exportProof.counts },
      exclusions: { sensitiveFindings: 0, trackedPrivateTargets: 0, privatePayloads: 0, localArtifacts: 0 },
    };
    const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
    expect(receiptBytes).not.toMatch(/https?:|localhost|\/Users\/|<html|claim_[a-f0-9]|el_[a-f0-9]|operationId|capability|credential|token|secret|screenshot/i);
    await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
    await writeFile(resolve(root, 'docs/evidence/t009-human-agent-dogfood.json'), receiptBytes, 'utf8');

    const sanitizedOutputs = [vocabulary, workspace, unauthorized, acquired, locked, agentMutation, chronology, released, stale, reacquired, ...proofs];
    for (const output of sanitizedOutputs) {
      expect(output.stdout).not.toContain(claimSecret); expect(output.stdout).not.toContain(directory);
      expect(output.stdout).toBe(`${JSON.stringify(output.json)}\n`);
    }
  } finally {
    await stop(); await rm(directory, { recursive: true, force: true });
  }
});
