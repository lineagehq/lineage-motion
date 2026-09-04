import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');

export async function startIsolatedQaEditor(repositoryRoot, label) {
  const directory = await mkdtemp(join(tmpdir(), `lineage-motion-chrome-${label}-`));
  const processHandle = spawn('npm', ['exec', 'vite-node', '--',
    resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: randomBytes(32).toString('base64url'),
      PHASE3_AGENT_CAPABILITY: randomBytes(32).toString('base64url') },
  });
  try {
    const addresses = await observeServerAddress(processHandle, `CHROME_QA_${label.toUpperCase().replaceAll('-', '_')}`);
    return { ...addresses, close: async () => { processHandle.kill('SIGTERM');
      if (processHandle.exitCode === null) await new Promise((resolveExit) => processHandle.once('exit', resolveExit));
      await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    processHandle.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); throw error;
  }
}

export async function ensureAdvancedOpen(page, groupSelector) {
  const toggle = page.locator('[data-shot-advanced-toggle]');
  const drawer = page.locator('[data-shot-advanced-drawer]');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await drawer.waitFor({ state: 'visible' });
  const group = drawer.locator(':scope > details').filter({ has: page.locator(groupSelector) });
  if (await group.count() !== 1) throw new Error('SHOT_ADVANCED_GROUP_MISSING');
  if (await group.getAttribute('open') === null) await group.locator('summary').click();
  return group;
}

export async function reserveEphemeralPort() {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('CHROME_QA_EPHEMERAL_PORT_UNAVAILABLE');
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

export function roundTimes(values) {
  return values.map((value) => value === null ? null : Math.round(value * 1000) / 1000);
}

export function monitorPage(page, allowedBaseUrls, diagnostics) {
  const allowedOrigins = new Set(allowedBaseUrls.map((value) => new URL(value).origin));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const evidence = { method: request.method(), resourceType: request.resourceType(),
      failure: request.failure()?.errorText ?? 'unknown' };
    if (diagnostics.allowFailedRequest?.(request)) diagnostics.expectedFailedRequests.push(evidence);
    else diagnostics.failedRequests.push(evidence);
  });
  page.on('request', (request) => {
    const target = request.url();
    if (!/^https?:/i.test(target)) return;
    if (!allowedOrigins.has(new URL(target).origin)) diagnostics.unexpectedNetwork.push({
      method: request.method(), resourceType: request.resourceType(),
    });
  });
  page.on('response', (response) => {
    if (!response.ok()) diagnostics.httpErrors.push({ status: response.status(), resourceType: response.request().resourceType() });
  });
}

export async function runRealCli(args) {
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64url');
  const child = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/qa-chrome.mjs'), '--real-cli', encoded],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolveExit) => child.once('exit', resolveExit));
  if (code !== 0) throw new Error(`REAL_CLI_FAILED_${code}_${stderr.length}`); return JSON.parse(stdout);
}

export async function resolveShot1CanonicalEasing(repositoryRoot, authority, privateDocumentPath) {
  const args = ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/qa-chrome.mjs'),
    '--resolve-shot1-canonical-easing', authority];
  if (authority === 'private') args.push(privateDocumentPath);
  const child = spawn('npm', args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderrLength = 0;
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderrLength += chunk.length; });
  const code = await new Promise((resolveExit) => child.once('exit', resolveExit));
  if (code !== 0) throw new Error(`SHOT1_CANONICAL_EASING_RESOLVER_FAILED_${code}_${stderrLength}`);
  return JSON.parse(stdout);
}

export function resolveShot1ProofAuthority(authority, availability) {
  if (authority === 'public') {
    if (!availability.publicFixture) throw new Error('SHOT1_PUBLIC_FIXTURE_REQUIRED');
    return { authority, source: 'fixtures/public-synthetic/landing-shot1.html' };
  }
  if (authority === 'private') {
    if (!availability.privateManifest || !availability.privateCanonical) throw new Error('SHOT1_PRIVATE_AUTHORITY_REQUIRED');
    return { authority, source: 'authenticated-ignored-manifest' };
  }
  throw new Error('SHOT1_PROOF_AUTHORITY_INVALID');
}

export function assertShot1ProofRouting() {
  const publicRoute = resolveShot1ProofAuthority('public', { publicFixture: true, privateManifest: false, privateCanonical: false });
  const privateRoute = resolveShot1ProofAuthority('private', { publicFixture: false, privateManifest: true, privateCanonical: true });
  if (publicRoute.source !== 'fixtures/public-synthetic/landing-shot1.html' || privateRoute.source !== 'authenticated-ignored-manifest') {
    throw new Error('SHOT1_PROOF_ROUTE_MISMATCH');
  }
  for (const assertion of [
    () => resolveShot1ProofAuthority('public', { publicFixture: false, privateManifest: true, privateCanonical: true }),
    () => resolveShot1ProofAuthority('private', { publicFixture: true, privateManifest: false, privateCanonical: false }),
  ]) {
    let rejected = false; try { assertion(); } catch { rejected = true; }
    if (!rejected) throw new Error('SHOT1_PROOF_FALLBACK_DETECTED');
  }
}

export async function observeActionCommit(page, expected) {
  try {
    await page.waitForFunction((contract) => { const inspected = window.__motionEditor.inspectAuthoring();
      const workspace = window.__motionEditor.inspectShotWorkspace();
      if (inspected.revision !== contract.revision || !workspace.previewMatchesCompiler) return false;
      const moments = [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value));
      if (contract.moments && JSON.stringify(moments) !== JSON.stringify(contract.moments)) return false;
      if (contract.landing !== undefined && Number(document.querySelector('[data-shot-context-time]').value) !== contract.landing) return false;
      const settled = moments.length > 3 ? moments.at(-2) : moments.at(-1);
      if (contract.settled !== undefined && settled !== contract.settled) return false;
      if (contract.easing !== undefined && document.querySelector('[data-shot-easing]').value !== contract.easing) return false;
      return true;
    }, expected);
  } catch (error) {
    const observed = await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), workspace: window.__motionEditor.inspectShotWorkspace(),
      moments: [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value)),
      landing: Number(document.querySelector('[data-shot-context-time]')?.value),
      settled: (() => { const values = [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value));
        return values.length > 3 ? values.at(-2) : values.at(-1); })(),
      easing: document.querySelector('[data-shot-easing]').value, status: document.querySelector('[data-shot-status]').value }));
    throw new Error(`ACTION_COMMIT_MISMATCH_${JSON.stringify({ expected, observed })}`, { cause: error });
  }
  return page.evaluate(() => window.__motionEditor.inspectAuthoring());
}

export async function observeGeometryCommit(page, { sampleCount, previousRequestId = null, moments = null }) {
  await page.waitForFunction((contract) => { const inspected = window.__motionEditor.inspectShotWorkspace();
    const frame = document.querySelector('[data-preview]'); const overlay = document.querySelector('[data-trajectory-overlay]');
    const handle = document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]'); const pump = inspected.geometryPump;
    if (overlay.getAttribute('aria-busy') !== 'false' || pump.running || pump.activeSamplers !== 0 || pump.pendingRequestId !== null
      || pump.lastCommittedRequestId === null || pump.lastCommittedRequestId !== pump.latestRequestId
      || (contract.previousRequestId !== null && pump.lastCommittedRequestId <= contract.previousRequestId)
      || (contract.sampleCount !== null && inspected.geometry.length !== contract.sampleCount)
      || inspected.geometry.some((sample) => Object.values(sample.deltasDevicePixels).some((delta) => delta > 1))
      || !inspected.previewMatchesCompiler) return false;
    const animations = frame.contentDocument?.getAnimations() ?? []; const state = window.__motionEditor.readState();
    if (animations.length === 0 || animations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline'
      || animation.currentTime !== state.playheadMs)) return false;
    if (contract.moments && JSON.stringify([...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value)))
      !== JSON.stringify(contract.moments)) return false;
    if (!(handle instanceof HTMLElement)) return false; const rect = handle.getBoundingClientRect(); const style = getComputedStyle(handle);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }, { sampleCount, previousRequestId, moments });
  return page.evaluate(() => window.__motionEditor.inspectShotWorkspace().geometryPump);
}

export async function currentGeometryRequestId(page) {
  return page.evaluate(() => window.__motionEditor.inspectShotWorkspace().geometryPump.lastCommittedRequestId);
}

export async function materializePublicAsymmetricSeed(repositoryRoot, seedPath) {
  const { createLandingShot1EditorSeed } = await import('../../../packages/local-service/src/seed.ts');
  const seed = createLandingShot1EditorSeed(repositoryRoot); const targetElementIds = seed.elements.map((element) => element.id).sort();
  const track = seed.tracks.find((candidate) => candidate.elementId === targetElementIds[0] && candidate.property === 'transform');
  const ruleTrack = track && seed.rules.find((rule) => rule.id === track.ruleId)?.tracks.find((candidate) => candidate.property === 'transform');
  const landed = ruleTrack?.keyframes.find((keyframe) => keyframe.offset === 0.1);
  if (!ruleTrack || !landed || targetElementIds.length !== 2) throw new Error('ASYMMETRIC_CHROME_SEED_INVALID');
  landed.value = landed.value.replace(/translate\([^)]*\)/, 'translate(-40px, 170px)');
  ruleTrack.keyframes.push({ ...landed, id: 'kf_asymmetric_1400', offset: 0.2 });
  ruleTrack.keyframes.sort((left, right) => left.offset - right.offset);
  for (const expanded of seed.tracks.filter((candidate) => candidate.ruleId === track.ruleId && candidate.property === 'transform')) {
    expanded.keyframeIds = ruleTrack.keyframes.map((keyframe) => keyframe.id);
  }
  await writeFile(seedPath, `${JSON.stringify(seed)}\n`); process.stdout.write(`${JSON.stringify({ targetElementIds })}\n`);
}

export async function runAsymmetricAlternatePrimaryQa({ repositoryRoot, directory, browser, port }) {
  const seedPath = resolve(directory, 'public-asymmetric.json');
  const seedProcess = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/qa-chrome.mjs'),
    '--materialize-public-asymmetric-seed', seedPath], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const { targetElementIds } = await observeServerAddress(seedProcess, 'ASYMMETRIC_SEED');
  const seedExitCode = seedProcess.exitCode ?? await new Promise((resolveExit) => seedProcess.once('exit', resolveExit));
  if (seedExitCode !== 0) throw new Error('ASYMMETRIC_SEED_EXIT');
  const humanCapability = randomBytes(32).toString('base64url'); const agentCapability = randomBytes(32).toString('base64url');
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, env: { ...process.env, PHASE3_DATABASE_PATH: resolve(directory, 'public-asymmetric.sqlite'),
      PHASE3_EDITOR_PORT: String(port), PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability,
      LANDING_SHOT1_WORKSPACE: '1', LANDING_SHOT1_DOCUMENT_PATH: seedPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let page;
  try {
    const addresses = await observeServerAddress(processHandle, 'ASYMMETRIC_CHROME_SERVER');
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [] };
    monitorPage(page, [addresses.editorUrl, addresses.serviceUrl], diagnostics);
    const commands = []; page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) commands.push(request.postDataJSON().command); });
    await page.goto(addresses.editorUrl); await page.locator('[data-editor-ready="true"]').waitFor();
    await observeGeometryCommit(page, { sampleCount: 4, moments: [0, 700, 1400, 2100] });
    const primaries = page.locator('[data-shot-targets] input[name="shot-primary"]');
    if (await primaries.count() !== 2 || await page.locator('[data-shot-targets] input[type="checkbox"]').count() !== 0) throw new Error('ASYMMETRIC_SCOPE_CONTROLS');
    if (await page.getByRole('button', { name: 'Path' }).getAttribute('aria-pressed') !== 'true') await page.getByRole('button', { name: 'Path' }).click();
    await observeGeometryCommit(page, { sampleCount: 4, moments: [0, 700, 1400, 2100] });
    const polishBaseline = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      contentDigest: window.__motionEditor.inspectAuthoring().contentDigest, exportDigest: window.__motionEditor.inspectAuthoring().exportDigest,
      native: window.__motionEditor.readState(), srcdoc: document.querySelector('[data-preview]').srcdoc,
      guidance: document.querySelector('[data-shot-guidance]').textContent, groupCopy: document.querySelector('.move-together').textContent }));
    const polishRejected = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      contentDigest: window.__motionEditor.inspectAuthoring().contentDigest, exportDigest: window.__motionEditor.inspectAuthoring().exportDigest,
      native: window.__motionEditor.readState(), srcdoc: document.querySelector('[data-preview]').srcdoc,
      value: document.querySelector('[data-shot-context-time]').value, min: document.querySelector('[data-shot-context-time]').min,
      max: document.querySelector('[data-shot-context-time]').max, status: document.querySelector('[data-shot-status]').value }));
    if (!polishBaseline.guidance.includes('Editing Object 1 at Point 1.')
      || !polishBaseline.guidance.includes('any corner to scale uniformly')
      || !polishBaseline.groupCopy.includes('Edit together') || !polishBaseline.groupCopy.includes('Position changes apply')
      || polishRejected.value !== '700' || polishRejected.min !== '1' || polishRejected.max !== '1399'
      || polishRejected.revision !== polishBaseline.revision || polishRejected.contentDigest !== polishBaseline.contentDigest
      || polishRejected.exportDigest !== polishBaseline.exportDigest || polishRejected.srcdoc !== polishBaseline.srcdoc
      || JSON.stringify(polishRejected.native) !== JSON.stringify(polishBaseline.native) || commands.length !== 0) {
      throw new Error('ASYMMETRIC_PATH_UX_POLISH_INVALID');
    }
    const readAlignment = () => page.evaluate(() => { const state = window.__motionEditor.readState(); const inspected = window.__motionEditor.inspectShotWorkspace();
      return { revision: window.__motionEditor.inspectAuthoring().revision, momentMs: inspected.momentMs, playheadMs: state.playheadMs,
        currentTimes: state.currentTimes, playStates: state.playStates, slider: Number(document.querySelector('[data-scrub]').value),
        visibleTime: document.querySelector('[data-playhead]').value, requestId: inspected.geometryPump.lastCommittedRequestId }; });
    const aligned = (state, timeMs, revision = 0) => state.revision === revision && state.momentMs === timeMs && state.playheadMs === timeMs
      && state.currentTimes.length > 0 && state.currentTimes.every((time) => time === timeMs)
      && state.playStates.every((playState) => playState === 'paused') && state.slider === timeMs && state.visibleTime === `${timeMs} ms`;
    await page.locator('input[name="shot-moment"][value="1400"]').check(); const primaryBaseline = await readAlignment();
    let priorRequestId = await currentGeometryRequestId(page); await primaries.nth(1).check();
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 700, 2100] });
    if (!aligned(primaryBaseline, 1400) || !aligned(await readAlignment(), 700) || commands.length !== 0
      || (await currentGeometryRequestId(page)) !== priorRequestId + 1) throw new Error('ASYMMETRIC_PRIMARY_RECONCILIATION_INVALID');
    const editBoth = page.locator('[data-move-together]'); await editBoth.check();
    const assertGrouped = async (moments) => {
      await observeGeometryCommit(page, { sampleCount: moments.length, moments });
      const scope = await page.evaluate(() => ({ primary: document.querySelector('[data-shot-targets] input[name="shot-primary"]:checked')?.value,
        grouped: document.querySelector('[data-move-together]').checked, selected: window.__motionEditor.inspectShotWorkspace().selectedElementIds,
        status: document.querySelector('[data-shot-status]').value }));
      if (scope.primary !== targetElementIds[1] || !scope.grouped || JSON.stringify(scope.selected) !== JSON.stringify(targetElementIds)
        || /INVALID|MISSING|DIVERGED/.test(scope.status)) throw new Error('ASYMMETRIC_GROUPED_SCOPE_DIVERGED');
    };
    await assertGrouped([0, 700, 2100]);
    await ensureAdvancedOpen(page, '[data-pose-form]');
    const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 1));
    priorRequestId = await currentGeometryRequestId(page); await page.getByRole('button', { name: 'Apply pose' }).click();
    await observeActionCommit(page, { revision: 1, moments: [0, 700, 2100], landing: 700, settled: 2100, easing: 'ease-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 700, 2100] }); await assertGrouped([0, 700, 2100]);
    await page.locator('[data-shot-advanced-close]').click();
    priorRequestId = await currentGeometryRequestId(page); await page.locator('[data-shot-context-time]').fill('840');
    await observeActionCommit(page, { revision: 2, moments: [0, 840, 2100], landing: 840, settled: 2100, easing: 'ease-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 840, 2100] }); await assertGrouped([0, 840, 2100]);
    priorRequestId = await currentGeometryRequestId(page); await page.locator('[data-shot-easing]').selectOption('ease-in-out'); await page.locator('[data-shot-apply-easing]').click();
    await observeActionCommit(page, { revision: 3, moments: [0, 840, 2100], landing: 840, settled: 2100, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 840, 2100] }); await assertGrouped([0, 840, 2100]);
    const history = [
      ['undo', 4, [0, 840, 2100], 840, 'ease-out'], ['undo', 5, [0, 700, 2100], 700, 'ease-out'],
      ['undo', 6, [0, 700, 2100], 700, 'ease-out'], ['redo', 7, [0, 700, 2100], 700, 'ease-out'],
      ['redo', 8, [0, 840, 2100], 840, 'ease-out'], ['redo', 9, [0, 840, 2100], 840, 'ease-in-out'],
    ];
    for (const [direction, revision, moments, landing, easing] of history) {
      priorRequestId = await currentGeometryRequestId(page); await page.locator(`[data-${direction}]`).click();
      await observeActionCommit(page, { revision, moments, landing, settled: 2100, easing });
      await observeGeometryCommit(page, { sampleCount: moments.length, previousRequestId: priorRequestId, moments }); await assertGrouped(moments);
    }
    await editBoth.uncheck(); await ensureAdvancedOpen(page, '[data-pose-form]');
    priorRequestId = await currentGeometryRequestId(page); await x.fill(String(Number(await x.inputValue()) + 1));
    await page.getByRole('button', { name: 'Apply pose' }).click();
    await observeActionCommit(page, { revision: 10, moments: [0, 840, 2100], landing: 840, settled: 2100, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 840, 2100] });
    const preparedCommands = commands.filter((command) => command.schemaVersion === 'motion.operation-intent.v1');
    const authorityLeak = JSON.stringify(preparedCommands).match(/expectedTransform|targetSnapshots|replacementTrackIds|"targets"/);
    const operationProof = commands.length === 10 && commands[0]?.kind === 'motion.transform-waypoints.translate'
      && JSON.stringify(commands[0]?.intent.elementIds) === JSON.stringify(targetElementIds)
      && commands[1]?.kind === 'motion.keyframe-group-time.set' && commands[2]?.kind === 'motion.keyframe-group-easing.set'
      && commands.at(-1)?.kind === 'motion.transform-pose.set' && commands.at(-1)?.intent.elementId === targetElementIds[1]
      && preparedCommands.length === 4 && !authorityLeak;
    if (!operationProof || diagnostics.consoleErrors.length || diagnostics.pageErrors.length || diagnostics.failedRequests.length
      || diagnostics.unexpectedNetwork.length || diagnostics.httpErrors.length) throw new Error('ASYMMETRIC_CHROME_PROOF_FAILED');
    return { passed: true, primaryIndex: 1, perObjectEditCheckboxesAbsent: true, groupedInventories: [[0, 700, 2100], [0, 840, 2100]],
      groupedOperationCount: 3, undoCount: 3, redoCount: 3, singlePrimaryOperation: true, nativeGeometryExact: true,
      preparedIntentCount: preparedCommands.length, authoritativePayloadExcluded: !authorityLeak };
  } finally {
    await page?.close(); processHandle.kill('SIGTERM'); if (processHandle.exitCode === null) await new Promise((done) => processHandle.once('exit', done));
  }
}

export async function runHitOwnershipQa({ repositoryRoot, directory, browser }) {
  const humanCapability = randomBytes(32).toString('base64url'); const agentCapability = randomBytes(32).toString('base64url');
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, env: { ...process.env, PHASE3_DATABASE_PATH: resolve(directory, 'hit-ownership.sqlite'),
      PHASE3_EDITOR_PORT: '0', PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability,
      LANDING_SHOT1_WORKSPACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let page;
  try {
    const addresses = await observeServerAddress(processHandle, 'HIT_OWNERSHIP_CHROME_SERVER');
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [] };
    monitorPage(page, [addresses.editorUrl, addresses.serviceUrl], diagnostics);
    const commands = []; page.on('request', (request) => {
      if (request.url().endsWith('/api/v1/commands')) commands.push(request.postDataJSON().command);
    });
    await page.goto(addresses.editorUrl); await page.locator('[data-editor-ready="true"]').waitFor();
    await observeGeometryCommit(page, { sampleCount: 3, moments: [0, 700, 2100] });
    const targets = page.locator('[data-shot-targets] input[name="shot-primary"]');
    const targetElementIds = await targets.evaluateAll((inputs) => inputs.map((input) => input.value));
    if (targetElementIds.length !== 2) throw new Error('HIT_OWNERSHIP_TARGET_COUNT');
    const moveTogether = page.locator('[data-move-together]'); if (await moveTogether.isChecked()) await moveTogether.uncheck();
    const pathToggle = page.locator('[data-shot-workspace] [data-shot-mode="path"]');
    if (await pathToggle.getAttribute('aria-pressed') === 'true') await pathToggle.click();
    const baselineDigest = await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest);
    const naturalCenter = (elementId) => page.evaluate((id) => {
      const frame = document.querySelector('[data-preview]'); const target = frame.contentDocument.querySelector(`[data-motion-id="${id}"]`);
      const frameRect = frame.getBoundingClientRect(); const targetRect = target.getBoundingClientRect();
      const x = frameRect.left + (targetRect.left + targetRect.width / 2) * frameRect.width / frame.clientWidth;
      const y = frameRect.top + (targetRect.top + targetRect.height / 2) * frameRect.height / frame.clientHeight;
      const hit = document.elementFromPoint(x, y);
      return { x, y, objectId: hit?.closest('[data-preview-object-id]')?.dataset.previewObjectId ?? null,
        waypointTimeMs: hit?.closest('[data-keyframe-id]')?.dataset.timeMs ?? null };
    }, elementId);
    const poseCenters = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport); await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
      await targets.nth(1).check(); await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
      const center = await naturalCenter(targetElementIds[1]);
      if (center.objectId !== targetElementIds[1] || center.waypointTimeMs !== null) {
        throw new Error(`HIT_OWNERSHIP_POSE_CENTER_${viewport.width}_${JSON.stringify(center)}`);
      }
      const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
      await page.mouse.move(center.x, center.y); await page.mouse.down();
      await page.mouse.move(center.x + 12, center.y + 6, { steps: 3 }); await page.mouse.up();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 1);
      if (commands.at(-1)?.kind !== 'motion.transform-pose.set'
        || commands.at(-1)?.schemaVersion !== 'motion.operation-intent.v1'
        || commands.at(-1)?.intent.elementId !== targetElementIds[1]) throw new Error('HIT_OWNERSHIP_POSE_OPERATION');
      await page.locator('[data-undo]').click();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 2);
      if (await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest) !== baselineDigest) {
        throw new Error('HIT_OWNERSHIP_POSE_UNDO');
      }
      poseCenters.push({ viewport, objectId: center.objectId, operation: 'motion.transform-pose.set', exactUndo: true });
    }
    await pathToggle.click(); await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    await page.locator('input[name="shot-moment"][value="700"]').check();
    await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    const currentCenter = await naturalCenter(targetElementIds[1]);
    if (currentCenter.waypointTimeMs !== '700') throw new Error(`HIT_OWNERSHIP_CURRENT_PATH_${JSON.stringify(currentCenter)}`);
    const dragWaypoint = async (timeMs) => {
      const waypoint = page.locator(`[data-trajectory-overlay] [data-keyframe-id][data-time-ms="${timeMs}"]`);
      const box = await waypoint.boundingBox(); if (!box) throw new Error(`HIT_OWNERSHIP_WAYPOINT_MISSING_${timeMs}`);
      const hitTimeMs = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-keyframe-id]')?.dataset.timeMs ?? null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      if (hitTimeMs !== String(timeMs)) throw new Error(`HIT_OWNERSHIP_WAYPOINT_HIT_${timeMs}_${hitTimeMs}`);
      const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 6, { steps: 3 }); await page.mouse.up();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 1);
      if (commands.at(-1)?.kind !== 'motion.transform-waypoints.translate'
        || commands.at(-1)?.schemaVersion !== 'motion.operation-intent.v1'
        || commands.at(-1)?.intent.momentMs !== timeMs) throw new Error(`HIT_OWNERSHIP_PATH_OPERATION_${timeMs}`);
      await page.locator('[data-undo]').click();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 2);
      if (await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest) !== baselineDigest) {
        throw new Error(`HIT_OWNERSHIP_PATH_UNDO_${timeMs}`);
      }
    };
    await dragWaypoint(700);
    await page.locator('input[name="shot-moment"][value="700"]').check();
    await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    await dragWaypoint(0);
    if (diagnostics.consoleErrors.length || diagnostics.pageErrors.length || diagnostics.failedRequests.length
      || diagnostics.unexpectedNetwork.length || diagnostics.httpErrors.length) throw new Error('HIT_OWNERSHIP_DIAGNOSTICS');
    return { passed: true, poseCenters, currentPathWaypoint: true, nonCurrentPathWaypoint: true,
      operationKinds: ['motion.transform-pose.set', 'motion.transform-waypoints.translate'], exactUndo: true };
  } finally {
    await page?.close(); processHandle.kill('SIGTERM');
    if (processHandle.exitCode === null) await new Promise((done) => processHandle.once('exit', done));
  }
}

export async function observeServerAddress(processHandle, label) {
  return new Promise((resolveAddress, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), 10000);
    processHandle.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
    });
    processHandle.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${label}_EXIT_${code}`)); });
  });
}

export async function readable(path) {
  try { await access(path); return true; } catch { return false; }
}
