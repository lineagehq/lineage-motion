import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { monitorPage, roundTimes, runHitOwnershipQa, startIsolatedQaEditor } from './qa-helpers.mjs';

export async function finishMainQaEvidence(context, root) {
  const { browser, url, mainServiceUrl, page, consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors, editorCommandRequestCount, initial, renderedTrackIds, timelineRows, renderedProjection, freshWorkflow, everyCueScrubbed, tolerance, beforePlay, duringPlay, afterPause, pausedInterval, advanceMs, pauseDriftMs, playPauseNative, reducedMotionInspectable, selectionOnly, selectionEphemeral, workflowStates, scrollBeforeCreate, createContinuity, shapeFocusEvidence, durationDraftVisible, durationDraftCleared, staleEvidence, expectedStaleConsoleIndex, expectedStaleConsole, expectedStaleHttpIndex, expectedStaleHttp, staleAtomic, invalidBaseline, validationEvidence, atomicState, invalidAtomic, exactHistory, historyUiRehydrated, undoSixClampProven, redoOneReverseContinuity, historySelectionTruth, disabledEditAtomic, historyObservations, historyStartState, anchorPreserved, historyRehydrated } = context;
  const structuralNative = await page.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return iframe.srcdoc === window.__motionEditor.compiledHtml
      && iframe.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  });
  const cursorEditor = await startIsolatedQaEditor(root, 'cursor');
  const cursorPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  monitorPage(cursorPage, [cursorEditor.editorUrl, cursorEditor.serviceUrl],
    { consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors });
  await cursorPage.goto(cursorEditor.editorUrl);
  await cursorPage.locator('[data-editor-ready="true"]').waitFor();
  await cursorPage.getByRole('radio', { name: /Cursor/ }).click();
  await cursorPage.getByRole('button', { name: 'Create Cursor opacity track' }).click();
  await cursorPage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1
    && document.activeElement?.hasAttribute('data-add-midpoint'));
  const cursorAlternate = await cursorPage.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return { state: window.__motionEditor.inspectAuthoring(),
      exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      native: iframe.contentDocument.getAnimations().every((animation) =>
        animation.constructor.name === 'CSSAnimation') };
  });
  await cursorPage.close();
  await cursorEditor.close();
  const orbTrackId = workflowStates[1].selectedTrackId;
  const cursorDistinct = cursorAlternate.state.revision === 1
    && cursorAlternate.state.selectedCreationElementId === 'el_a2849ff826f3e167'
    && cursorAlternate.state.selectedTrackId !== orbTrackId
    && cursorAlternate.exact && cursorAlternate.native;

  const responsive = {};
  for (const width of [1440, 1099, 768, 390]) {
    const responsiveEditor = await startIsolatedQaEditor(root, `responsive-${width}`);
    const responsivePage = await browser.newPage({ viewport: { width, height: 1000 } });
    monitorPage(responsivePage, [responsiveEditor.editorUrl, responsiveEditor.serviceUrl],
      { consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors });
    await responsivePage.goto(responsiveEditor.editorUrl);
    await responsivePage.locator('[data-editor-ready="true"]').waitFor();
    responsive[width] = await responsivePage.evaluate(() => {
      const workflow = document.querySelector('.workflow').getBoundingClientRect();
      const preview = document.querySelector('.preview-panel').getBoundingClientRect();
      return { contained: document.documentElement.scrollWidth <= innerWidth,
        twoColumn: Math.abs(workflow.top - preview.top) < 2 && preview.left > workflow.left,
        oneColumn: preview.top > workflow.top };
    });
    if (width <= 768) {
      await responsivePage.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
      responsive[width].localTrackOverflow = await responsivePage.locator('.timeline-panel')
        .evaluate((node) => node.scrollWidth > node.clientWidth && document.documentElement.scrollWidth <= innerWidth);
      await responsivePage.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
    }
    const responsiveInitial = await responsivePage.evaluate(() => window.__motionEditor.inspectAuthoring());
    await responsivePage.getByRole('radio', { name: /Orb/ }).click();
    await responsivePage.locator('[data-create-track]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1);
    const responsiveCreated = await responsivePage.evaluate(() => window.__motionEditor.inspectAuthoring());
    await responsivePage.locator('[data-undo]').evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await responsivePage.locator('[data-undo]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 2
      && document.querySelector('[data-undo]').disabled
      && document.querySelector('[data-undo]').hasAttribute('data-history-viewport-top-after')
      && document.querySelector('[data-operation-status]').textContent.includes('Revision 2'));
    const responsiveUndo = await responsivePage.locator('[data-undo]').evaluate((button) => { const state = window.__motionEditor.inspectAuthoring(); return {
      state: { revision: state.revision, contentDigest: state.contentDigest, exportDigest: state.exportDigest },
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }; });
    await responsivePage.locator('[data-redo]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 3
      && document.querySelector('[data-redo]').disabled
      && document.querySelector('[data-redo]').hasAttribute('data-history-viewport-top-after')
      && document.querySelector('[data-operation-status]').textContent.includes('Revision 3'));
    const responsiveRedo = await responsivePage.locator('[data-redo]').evaluate((button) => { const state = window.__motionEditor.inspectAuthoring(); return {
      state: { revision: state.revision, contentDigest: state.contentDigest, exportDigest: state.exportDigest },
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
      contained: document.documentElement.scrollWidth <= innerWidth,
    }; });
    responsive[width].historyEvidence = { undo: responsiveUndo, redo: responsiveRedo };
    responsive[width].historyAnchor = anchorPreserved(responsiveUndo)
      && anchorPreserved(responsiveRedo) && responsiveRedo.contained
      && responsiveUndo.state.contentDigest === responsiveInitial.contentDigest
      && responsiveRedo.state.contentDigest === responsiveCreated.contentDigest;
    await responsivePage.close();
    await responsiveEditor.close();
  }
  const responsiveContract = responsive[1440].twoColumn && responsive[1440].contained
    && [1099, 768, 390].every((width) => responsive[width].oneColumn && responsive[width].contained)
    && responsive[768].localTrackOverflow && responsive[390].localTrackOverflow;
  const responsiveHistoryAnchors = [1440, 1099, 768, 390]
    .every((width) => responsive[width].historyAnchor);

  const persistenceDirectory = await mkdtemp(join(tmpdir(), 'lineage-motion-chrome-'));
  const persistencePort = 0;
  const humanCapability = randomBytes(32).toString('base64url');
  const agentCapability = randomBytes(32).toString('base64url');
  const persistence = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(persistenceDirectory, 'project.sqlite'),
      PHASE3_EDITOR_PORT: String(persistencePort), PHASE3_HUMAN_CAPABILITY: humanCapability,
      PHASE3_AGENT_CAPABILITY: agentCapability }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let persistenceChecks;
  try {
    const addresses = await observeServerAddress(persistence, 'PERSISTENCE_CHROME');
    const persistencePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const persistenceErrors = []; const persistencePageErrors = []; const persistenceFailedRequests = [];
    const expectedFailedRequests = []; let allowExpectedEventAbort = false;
    const persistenceUnexpectedNetwork = []; const persistenceHttpErrors = [];
    const persistenceDiagnostics = { consoleErrors: persistenceErrors, pageErrors: persistencePageErrors,
      failedRequests: persistenceFailedRequests, unexpectedNetwork: persistenceUnexpectedNetwork,
      httpErrors: persistenceHttpErrors, expectedFailedRequests,
      allowFailedRequest: (request) => allowExpectedEventAbort
        && request.url().endsWith('/events') && request.failure()?.errorText === 'net::ERR_ABORTED' };
    monitorPage(persistencePage, [addresses.editorUrl, addresses.serviceUrl], persistenceDiagnostics);
    const editorOperationIds = []; const eventCursors = [];
    const captureEditorOperationId = (request) => {
      if (!request.url().endsWith('/api/v1/commands')) return;
      const command = request.postDataJSON();
      if (typeof command?.operationId === 'string' && command.operationId.startsWith('editor:'))
        editorOperationIds.push(command.operationId);
    };
    persistencePage.on('request', captureEditorOperationId);
    persistencePage.on('request', (request) => { if (request.url().endsWith('/events'))
      eventCursors.push(request.headers()['last-event-id'] ?? 'missing'); });
    await persistencePage.goto(addresses.editorUrl); await persistencePage.locator('[data-editor-ready="true"]').waitFor();
    await persistencePage.locator('.collaboration-details summary').click();
    await persistencePage.locator('[data-new-branch]').fill('chromefeature');
    await persistencePage.locator('[data-branch-form] button').click();
    await persistencePage.waitForFunction(() => document.querySelector('[data-operation-status]').textContent.includes('Branch chromefeature head revision 0 loaded'));
    const mainEditorPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    monitorPage(mainEditorPage, [addresses.editorUrl, addresses.serviceUrl], persistenceDiagnostics);
    mainEditorPage.on('request', captureEditorOperationId);
    await mainEditorPage.goto(addresses.editorUrl); await mainEditorPage.locator('[data-editor-ready="true"]').waitFor();
    await mainEditorPage.locator('.collaboration-details summary').click();
    const documentId = await persistencePage.evaluate(() => window.__motionEditor.inspectAuthoring().documentId);
    const secret = ['chrome', 'claim', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const acquisition = { protocolVersion: 'motion.protocol.v1', operationId: 'chrome-claim', documentId,
      branchId: 'chromefeature', expectedRevision: 0, command: { schemaVersion: 'motion.control.v1',
        kind: 'motion.claim.acquire', operationId: 'chrome-claim', documentId, expectedRevision: 0,
        payload: { scope: 'branch', branchId: 'chromefeature' } } };
    const acquired = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${agentCapability}`, 'x-motion-actor': 'agent',
      'x-motion-claim-secret': secret }, body: JSON.stringify(acquisition) }).then((response) => response.json());
    await persistencePage.locator('[data-claim-id]').fill(acquired.claimId);
    await persistencePage.locator('[data-lease-version]').fill(String(acquired.leaseVersion));
    await persistencePage.locator('[data-revoke-form] button').click();
    await persistencePage.waitForFunction(() => document.querySelector('[data-operation-status]').textContent.includes('revoked at lease version 2'));
    await persistencePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().lastCommitSeq >= 3);
    await persistencePage.getByRole('radio', { name: /Orb/ }).click();
    await persistencePage.locator('[data-new-branch]').fill('');
    allowExpectedEventAbort = true;
    await persistencePage.evaluate(() => window.__motionEditor.disconnectEvents());
    await persistencePage.waitForTimeout(50);
    allowExpectedEventAbort = false;
    const cliFeature = await runRealCli(['track-create', '--service', addresses.serviceUrl, '--operation-id', 'chrome-cli-feature',
      '--document-id', documentId, '--branch-id', 'chromefeature', '--expected-revision', '0',
      '--element-id', 'el_2dbee68b1ea318c8', '--capability', humanCapability]);
    await persistencePage.evaluate(() => window.__motionEditor.reconnectEvents());
    await persistencePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1
      && window.__motionEditor.inspectAuthoring().lastCommitSeq >= 4
      && !document.querySelector('[data-draft-conflict]').hidden);
    const combinedReconnectDraft = await persistencePage.evaluate(() => { const frame = document.querySelector('[data-preview]');
      const state = window.__motionEditor.inspectAuthoring(); return { revision: state.revision, cursor: state.lastCommitSeq,
        staleBase: state.draftStaleBaseRevision, dirty: state.draftDirty, emptyDraft: state.draftValues['[data-new-branch]'] === '',
        targetId: state.selectedCreationElementId, conflictVisible: !document.querySelector('[data-draft-conflict]').hidden,
        exactCompilerOutput: frame.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimations: frame.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    const mainWrite = { protocolVersion: 'motion.protocol.v1', operationId: 'chrome-diverged-main', documentId,
      branchId: 'main', expectedRevision: 0, command: { schemaVersion: 'motion.operation.v1', kind: 'motion.track.create',
        operationId: 'chrome-diverged-main', documentId, expectedRevision: 0, elementId: 'el_a2849ff826f3e167',
        payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } } };
    const mainWritten = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${humanCapability}`, 'x-motion-actor': 'human',
    }, body: JSON.stringify(mainWrite) }).then((response) => response.json());
    const documentSecret = ['chrome', 'document', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const documentAcquisition = { protocolVersion: 'motion.protocol.v1', operationId: 'chrome-document-claim', documentId,
      branchId: 'chromefeature', expectedRevision: 2, command: { schemaVersion: 'motion.control.v1',
        kind: 'motion.claim.acquire', operationId: 'chrome-document-claim', documentId, expectedRevision: 2,
        payload: { scope: 'document' } } };
    const documentAcquired = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${agentCapability}`, 'x-motion-actor': 'agent',
      'x-motion-claim-secret': documentSecret }, body: JSON.stringify(documentAcquisition) }).then((response) => response.json());
    const agentHeaders = { 'content-type': 'application/json', authorization: `Bearer ${agentCapability}`,
      'x-motion-actor': 'agent', 'x-motion-claim-secret': documentSecret };
    const control = async (kind, operationId, claimId, leaseVersion) => fetch(`${addresses.serviceUrl}/api/v1/commands`, {
      method: 'POST', headers: agentHeaders, body: JSON.stringify({ protocolVersion: 'motion.protocol.v1', operationId,
        documentId, branchId: 'chromefeature', expectedRevision: 2, command: { schemaVersion: 'motion.control.v1', kind,
          operationId, documentId, expectedRevision: 2, payload: { claimId, leaseVersion } } }),
    }).then((response) => response.json());
    const documentRenewed = await control('motion.claim.renew', 'chrome-document-renew', documentAcquired.claimId, 1);
    const documentReleased = await control('motion.claim.release', 'chrome-document-release', documentAcquired.claimId, 2);
    const reacquisition = { ...documentAcquisition, operationId: 'chrome-document-reacquire', command: {
      ...documentAcquisition.command, operationId: 'chrome-document-reacquire' } };
    const documentReacquired = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: agentHeaders,
      body: JSON.stringify(reacquisition) }).then((response) => response.json());
    await mainEditorPage.locator('[data-claim-id]').fill(documentReacquired.claimId);
    await mainEditorPage.locator('[data-lease-version]').fill(String(documentReacquired.leaseVersion));
    await mainEditorPage.locator('[data-revoke-form] button').click();
    await mainEditorPage.waitForFunction(() => document.querySelector('[data-operation-status]').value
      .includes('revoked at lease version 2'));
    const readHeaders = { authorization: `Bearer ${humanCapability}`, 'x-motion-actor': 'human' };
    const mainHead = await fetch(`${addresses.serviceUrl}/api/v1/documents/${encodeURIComponent(documentId)}/branches/main/head`, { headers: readHeaders })
      .then((response) => response.json());
    const featureHead = await fetch(`${addresses.serviceUrl}/api/v1/documents/${encodeURIComponent(documentId)}/branches/chromefeature/head`, { headers: readHeaders })
      .then((response) => response.json());
    persistenceChecks = await persistencePage.evaluate(() => { const frame = document.querySelector('[data-preview]');
      return { branch: window.__motionEditor.inspectAuthoring().activeBranchId,
        revision: window.__motionEditor.inspectAuthoring().revision,
        lastCommit: window.__motionEditor.inspectAuthoring().lastCommit,
        exactCompilerOutput: frame.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimations: frame.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    persistenceChecks.mainEditor = await mainEditorPage.evaluate(() => { const frame = document.querySelector('[data-preview]');
      return { branch: window.__motionEditor.inspectAuthoring().activeBranchId,
        revision: window.__motionEditor.inspectAuthoring().revision,
        exactCompilerOutput: frame.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimations: frame.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    persistenceChecks.divergedControlIsolated = mainWritten.resultingRevision === 2 && mainHead.document.revision === 2
      && featureHead.document.revision === 1 && documentAcquired.resultingRevision === 1
      && documentRenewed.leaseVersion === 2 && documentReleased.leaseVersion === 3
      && documentReacquired.leaseVersion === 1 && persistenceChecks.revision === 1
      && persistenceChecks.mainEditor.branch === 'main' && persistenceChecks.mainEditor.revision === 2
      && persistenceChecks.mainEditor.exactCompilerOutput && persistenceChecks.mainEditor.nativeAnimations;
    persistenceChecks.combinedReconnectDraft = cliFeature.ok && cliFeature.resultingRevision === 1
      && combinedReconnectDraft.revision === 1 && combinedReconnectDraft.cursor >= 4 && combinedReconnectDraft.staleBase === 0
      && combinedReconnectDraft.dirty && combinedReconnectDraft.emptyDraft
      && combinedReconnectDraft.targetId === 'el_2dbee68b1ea318c8' && combinedReconnectDraft.conflictVisible
      && combinedReconnectDraft.exactCompilerOutput && combinedReconnectDraft.nativeAnimations
      && eventCursors.some((cursor) => Number(cursor) > 0);
    persistenceChecks.combinedReconnectDraftObserved = combinedReconnectDraft;
    persistenceChecks.eventCursors = eventCursors;
    persistenceChecks.editorOperationIds = editorOperationIds;
    persistenceChecks.collisionFreeEditorOperationIds = editorOperationIds.length === 3
      && editorOperationIds.every((operationId) => /^editor:[0-9a-f-]{36}:[1-3]$/.test(operationId))
      && new Set(editorOperationIds).size === editorOperationIds.length;
    persistenceChecks.consoleErrors = persistenceErrors; persistenceChecks.pageErrors = persistencePageErrors;
    persistenceChecks.failedRequests = persistenceFailedRequests;
    persistenceChecks.expectedDisconnectAbortCount = expectedFailedRequests.length;
    persistenceChecks.unexpectedNetwork = persistenceUnexpectedNetwork;
    persistenceChecks.httpErrors = persistenceHttpErrors;
    persistenceChecks.noConsoleErrors = persistenceErrors.length === 0;
    persistenceChecks.noPageErrors = persistencePageErrors.length === 0;
    persistenceChecks.noFailedRequests = persistenceFailedRequests.length === 0;
    persistenceChecks.noUnexpectedNetwork = persistenceUnexpectedNetwork.length === 0;
    persistenceChecks.noHttpErrors = persistenceHttpErrors.length === 0;
    await persistencePage.close(); await mainEditorPage.close();
  } finally {
    persistence.kill('SIGTERM'); if (persistence.exitCode === null) await new Promise((resolveExit) => persistence.once('exit', resolveExit));
    await rm(persistenceDirectory, { recursive: true, force: true });
  }

  const checks = {
    exactCompilerOutput: initial.exactCompilerOutput,
    minimalSandbox: initial.sandbox === 'allow-same-origin',
    nativeAnimationsOnly: initial.animationCount > 0
      && initial.nativeAnimationCount === initial.animationCount,
    completeTrackRows: renderedTrackIds.length === initial.trackIds.length
      && new Set(renderedTrackIds).size === renderedTrackIds.length
      && initial.trackIds.every((id) => renderedTrackIds.includes(id)),
    completeTrackDetails: timelineRows.every((row) => row.elementId && row.property
      && Number.isFinite(row.delayMs) && row.declaredKeyframes === row.renderedKeyframes),
    canonicalProjectionEqual: isDeepStrictEqual(renderedProjection, initial.canonicalProjection),
    simultaneousSlotsShown: timelineRows.some((row) => row.slotCount > 1),
    stepTimingShown: timelineRows.some((row) => row.timingKind === 'steps'),
    everyCueScrubbed,
    playPauseNative,
    reducedMotionInspectable,
    freshStateTruthful: freshWorkflow.noFalseKeyframeClaim && freshWorkflow.inspectionCollapsed,
    uniqueApplyNames: isDeepStrictEqual(freshWorkflow.uniqueApplyNames,
      ['Apply duration', 'Apply delay', 'Apply easing']),
    initialDocumentContained: freshWorkflow.documentContained,
    selectionEphemeral,
    structuralWorkflow: workflowStates.length === 7 && workflowStates.at(-1).revision === 6,
    createContinuity: createContinuity.focus && createContinuity.noScroll
      && createContinuity.duration === '1000' && createContinuity.delay === '610'
      && createContinuity.easing === 'linear',
    shapeFocusIntentional: Object.values(shapeFocusEvidence).every(Boolean),
    draftTruthConditional: durationDraftVisible && durationDraftCleared,
    staleAtomic,
    invalidAtomic,
    exactSixStepHistory: exactHistory,
    historyUiRehydrated,
    historySelectionTruth,
    disabledEditAtomic,
    undoSixClampProven,
    redoOneReverseContinuity,
    historyRehydrated: historyRehydrated.duration === '1400' && historyRehydrated.delay === '700'
      && historyRehydrated.easing === 'ease-in-out'
      && historyRehydrated.appliedDuration === 'Applied · 1400 ms',
    responsiveContract,
    responsiveHistoryAnchors,
    structuralNative,
    cursorDistinct,
    persistentBranchClaimPath: persistenceChecks.branch === 'chromefeature' && persistenceChecks.exactCompilerOutput
      && persistenceChecks.nativeAnimations && persistenceChecks.divergedControlIsolated
      && persistenceChecks.combinedReconnectDraft && persistenceChecks.collisionFreeEditorOperationIds
      && persistenceChecks.noConsoleErrors && persistenceChecks.noPageErrors
      && persistenceChecks.noFailedRequests && persistenceChecks.expectedDisconnectAbortCount === 1
      && persistenceChecks.noUnexpectedNetwork && persistenceChecks.noHttpErrors,
    noConsoleErrors: consoleErrors.length === 0,
    noPageErrors: pageErrors.length === 0,
    noFailedRequests: failedRequests.length === 0,
    noUnexpectedNetwork: unexpectedNetwork.length === 0,
    noHttpErrors: httpErrors.length === 0,
  };
  const receipt = {
    schemaVersion: 'motion.target-selection-chrome-qa.v1',
    passed: Object.values(checks).every(Boolean),
    browser: { name: 'Google Chrome', version: browser.version() },
    viewport: { width: 1280, height: 720 },
    counts: {
      animationCount: initial.animationCount,
      cueCount: initial.cueIds.length,
      trackCount: initial.trackIds.length,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      failedRequestCount: failedRequests.length,
      unexpectedNetworkCount: unexpectedNetwork.length,
      httpErrorCount: httpErrors.length,
    },
    nativeTiming: {
      tolerance,
      beforePlayCurrentTimes: roundTimes(beforePlay.currentTimes),
      duringPlayCurrentTimes: roundTimes(duringPlay.currentTimes),
      afterPauseCurrentTimes: roundTimes(afterPause.currentTimes),
      pausedIntervalCurrentTimes: roundTimes(pausedInterval.currentTimes),
      advanceMs: roundTimes(advanceMs),
      pauseDriftMs: roundTimes(pauseDriftMs),
    },
    workflowEvidence: { durationDraftVisible, durationDraftCleared, historyRehydrated, historyObservations },
    responsive,
    persistence: persistenceChecks,
    checks,
  };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(root, 'artifacts/t005-ux-simplification-chrome-qa.json'), receiptText, 'utf8'),
    writeFile(resolve(root, 'artifacts/t002-target-selection-chrome-qa.json'), receiptText, 'utf8'),
    writeFile(resolve(root, 'artifacts/t004-chrome-qa.json'), receiptText, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.passed) process.exitCode = 1;
}
