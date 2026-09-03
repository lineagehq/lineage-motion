import { createServer, type Server, type ServerResponse } from 'node:http';

import { canonicalJson, sha256Hex, type MotionDocument } from '../../domain/src/index.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { parseCommandDetailed, parseOperationPreparationRequest, type CommandFailure,
  type CommitMetadata } from '../../motion-protocol/src/index.ts';
import { parseHandoffRequest, parseReviewCommand, reviewFailure, type ReviewEvent } from '../../motion-protocol/src/review.ts';
import type { ProjectStore } from '../../project-store/src/index.ts';
import { acquireStoreLock, type StoreLock } from './lock-runner.ts';
import { prepareStorePath } from './paths.ts';
import { SqliteProjectStore, type FaultPoint } from './sqlite-project-store.ts';
import { authenticate, validateServiceCapabilities, type ServiceCapabilities } from './auth.ts';

export type LocalMotionService = { url: string; store: ProjectStore; lockHolderPid: number; close(): Promise<void> };

const legacyTestCapabilities = { human: 'human-editor', agent: 'cli-agent' };

export async function startLocalMotionService(options: { databasePath: string; seed: MotionDocument;
  port?: number; host?: '127.0.0.1' | '::1'; fault?: (point: FaultPoint) => void;
  capabilities?: ServiceCapabilities; now?: () => number }): Promise<LocalMotionService> {
  const capabilities = options.capabilities
    ? validateServiceCapabilities(options.capabilities)
    : process.env.VITEST ? legacyTestCapabilities : (() => { throw new Error('SERVICE_CAPABILITIES_REQUIRED'); })();
  const { databasePath, lockPath } = prepareStorePath(options.databasePath);
  let lock: StoreLock | undefined;
  let store: ProjectStore | undefined;
  try {
    lock = await acquireStoreLock(lockPath);
    store = new SqliteProjectStore(databasePath, options.fault);
    store.initialize(options.seed);
  } catch (error) { store?.close(); await lock?.release(); throw error; }
  const subscribers = new Map<string, Set<ServerResponse>>();
  const reviewSubscribers = new Map<string, Set<ServerResponse>>();
  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
      if (request.method === 'POST' && url.pathname === '/api/review/v1/commands') {
        const auth = authenticate(request, capabilities);
        if (!auth) return json(response, 403, reviewFailure('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN', 'authorization', false));
        let input: unknown; try { input = await readJson(request); }
        catch { return json(response, 422, reviewFailure('VALIDATION', 'PROTOCOL_REVIEW_COMMAND_INVALID', 'protocol', false)); }
        const parsed = parseReviewCommand(input); if (!parsed.ok) return json(response,
          parsed.response.code === 'UNSUPPORTED_VERSION' ? 400 : 422, parsed.response);
        let result; try { result = store!.executeReview(parsed.command, { ...auth, now: options.now?.() ?? Date.now() }); }
        catch { return json(response, 500, reviewFailure('STORAGE_FAILURE', 'STORAGE_FAILURE', 'storage', true)); }
        if (result.event && !result.replayed) publishReview(reviewSubscribers.get(result.event.documentId), result.event);
        return json(response, result.response.ok ? 200 : result.response.code === 'UNAUTHORIZED_CLAIM' ? 403
          : result.response.code.startsWith('STALE_') ? 409 : 422, result.response);
      }
      const annotations = url.pathname.match(/^\/api\/review\/v1\/documents\/([^/]+)\/branches\/([^/]+)\/annotations$/);
      if (request.method === 'GET' && annotations) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const found = store!.listAnnotations(decodeURIComponent(annotations[1]!), decodeURIComponent(annotations[2]!));
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const comparison = url.pathname.match(/^\/api\/review\/v1\/documents\/([^/]+)\/compare$/);
      if (request.method === 'GET' && comparison) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const left = parseNonnegative(url.searchParams.get('left'), -1); const right = parseNonnegative(url.searchParams.get('right'), -1);
        if (left === null || right === null || left < 0 || right < 0) return json(response, 400, { ok: false, code: 'VALIDATION' });
        const found = store!.compareRevisions(decodeURIComponent(comparison[1]!), left, right);
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      if (request.method === 'POST' && url.pathname === '/api/review/v1/handoffs') {
        const auth = authenticate(request, capabilities);
        if (!auth) return json(response, 403, reviewFailure('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN', 'authorization', false));
        let input: unknown; try { input = await readJson(request); } catch { return json(response, 422, { ok: false, code: 'VALIDATION' }); }
        const parsed = parseHandoffRequest(input); if (!parsed.ok) return json(response, 422, parsed.response);
        let result; try { result = store!.createHandoff(parsed.operationId, parsed.identity, { ...auth, now: options.now?.() ?? Date.now() }); }
        catch { return json(response, 500, reviewFailure('STORAGE_FAILURE', 'STORAGE_FAILURE', 'storage', true)); }
        return json(response, 'ok' in result && !result.ok ? 422 : 200, result);
      }
      const reviewEvents = url.pathname.match(/^\/api\/review\/v1\/documents\/([^/]+)\/events$/);
      if (request.method === 'GET' && reviewEvents) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const documentId = decodeURIComponent(reviewEvents[1]!); const rawCursor = request.headers['last-event-id'];
        if (Array.isArray(rawCursor) || (rawCursor !== undefined && !/^\d+$/.test(rawCursor)))
          return json(response, 400, { ok: false, code: 'VALIDATION' });
        const cursor = rawCursor === undefined ? 0 : Number(rawCursor);
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-store' });
        const set = reviewSubscribers.get(documentId) ?? new Set<ServerResponse>(); set.add(response); reviewSubscribers.set(documentId, set);
        for (const event of store!.readReviewEvents(documentId, cursor)) publishReview(new Set([response]), event);
        response.write(': connected\n\n'); request.on('close', () => set.delete(response)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/commands') {
        let input: unknown; try { input = await readJson(request); }
        catch { return json(response, 422, commandFailure('VALIDATION', 'PROTOCOL_COMMAND_INVALID', 'protocol', false, '$')); }
        const parsed = parseCommandDetailed(input);
        if (!parsed.ok) return json(response, parsed.response.code === 'UNSUPPORTED_VERSION' ? 400 : 422, parsed.response);
        const auth = authenticate(request, capabilities);
        if (!auth) return json(response, 403, commandFailure('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN', 'authorization', false));
        let result;
        try { result = store!.execute(parsed.command, { ...auth, now: options.now?.() ?? Date.now() }); }
        catch { return json(response, 500, commandFailure('STORAGE_FAILURE', 'STORAGE_FAILURE', 'storage', true)); }
        if ('event' in result && !result.replayed) publish(subscribers.get(result.event.documentId), result.event);
        return json(response, result.response.ok ? 200 : result.response.code === 'STALE_REVISION' ? 409
          : result.response.code === 'UNAUTHORIZED_CLAIM' ? 403 : 422, result.response);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/commands/validate') {
        let input: unknown; try { input = await readJson(request); }
        catch { const invalid = commandFailure('VALIDATION', 'PROTOCOL_COMMAND_INVALID', 'protocol', false, '$');
          return json(response, 422, { schemaVersion: 'motion.command-validation.v1', valid: false, response: invalid }); }
        const parsed = parseCommandDetailed(input);
        if (!parsed.ok) return json(response, 422, { schemaVersion: 'motion.command-validation.v1', valid: false,
          response: parsed.response });
        const auth = authenticate(request, capabilities);
        if (!auth) return json(response, 403, { schemaVersion: 'motion.command-validation.v1', valid: false, response: {
          ok: false, code: 'UNAUTHORIZED_CLAIM', diagnostic: { schemaVersion: 'motion.diagnostic.v1',
            code: 'ACTOR_FORBIDDEN', category: 'authorization', retryable: false } } });
        const checked = store!.validate(parsed.command, { ...auth, now: options.now?.() ?? Date.now() });
        return json(response, 200, { schemaVersion: 'motion.command-validation.v1', valid: checked.ok,
          response: checked.ok ? { ok: true } : checked });
      }
      const preparation = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/branches\/([^/]+)\/operations\/prepare$/);
      if (request.method === 'POST' && preparation) {
        if (!authenticate(request, capabilities)) return json(response, 403,
          commandFailure('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN', 'authorization', false));
        let parsed; try { parsed = parseOperationPreparationRequest(await readJson(request)); }
        catch { return json(response, 422, commandFailure('VALIDATION', 'PROTOCOL_PREPARATION_REQUEST_INVALID',
          'protocol', false, '$')); }
        const documentId = decodeURIComponent(preparation[1]!); const branchId = decodeURIComponent(preparation[2]!);
        if (parsed.documentId !== documentId || parsed.branchId !== branchId)
          return json(response, 422, commandFailure('VALIDATION', 'PROTOCOL_PREPARATION_REQUEST_INVALID',
            'protocol', false, '$'));
        let found; try { found = store!.prepareOperation(parsed); }
        catch { return json(response, 500, commandFailure('STORAGE_FAILURE', 'STORAGE_FAILURE', 'storage', true)); }
        return json(response, found ? 200 : 404, found ??
          commandFailure('VALIDATION', 'BRANCH_NOT_FOUND', 'target', false));
      }
      const workspace = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/branches\/([^/]+)\/workspace$/);
      if (request.method === 'GET' && workspace) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const found = store!.readWorkspace(decodeURIComponent(workspace[1]!), decodeURIComponent(workspace[2]!));
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const branches = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/branches$/);
      if (request.method === 'GET' && branches) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const found = store!.listBranches(decodeURIComponent(branches[1]!)); return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const claims = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/claims$/);
      if (request.method === 'GET' && claims) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        if (url.searchParams.get('status') !== 'active') return json(response, 400, { ok: false, code: 'VALIDATION' });
        const found = store!.listActiveClaims(decodeURIComponent(claims[1]!), options.now?.() ?? Date.now());
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const activity = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/activity$/);
      if (request.method === 'GET' && activity) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const after = parseNonnegative(url.searchParams.get('afterCommitSeq'), 0); const limit = parsePositive(url.searchParams.get('limit'), 100);
        if (after === null || limit === null || limit > 500) return json(response, 400, { ok: false, code: 'VALIDATION' });
        const found = store!.listActivity(decodeURIComponent(activity[1]!), after, limit);
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const exportProof = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/branches\/([^/]+)\/export-proof$/);
      if (request.method === 'GET' && exportProof) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const documentId = decodeURIComponent(exportProof[1]!); const branchIdValue = decodeURIComponent(exportProof[2]!);
        const found = store!.readHead(documentId, branchIdValue); if (!found) return json(response, 404, { ok: false });
        const compiled = compileMotionDocument(found.document); return json(response, 200, {
          schemaVersion: 'motion.export-proof.v1', documentId, branchId: branchIdValue, revision: found.document.revision,
          canonicalDigest: found.canonicalDigest, htmlDigest: sha256Hex(compiled.html), cssDigest: sha256Hex(compiled.css),
          exportDigest: compiled.exportDigest, reducedMotionDigest: sha256Hex(found.document.reducedMotion.css), counts: {
            ruleCount: found.document.inventory.ruleCount, applicationCount: found.document.inventory.applicationCount,
            slotCount: found.document.inventory.slotCount, trackCount: found.document.inventory.trackCount } });
      }
      const head = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/(?:branches\/([^/]+)\/)?head$/);
      if (request.method === 'GET' && head) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const found = store!.readHead(decodeURIComponent(head[1]!), head[2] ? decodeURIComponent(head[2]) : undefined);
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const revision = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/revisions\/(\d+)$/);
      if (request.method === 'GET' && revision) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const found = store!.readRevision(decodeURIComponent(revision[1]!), Number(revision[2]));
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const documentRevision = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/revision$/);
      if (request.method === 'GET' && documentRevision) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const found = (store as SqliteProjectStore).readDocumentRevision(decodeURIComponent(documentRevision[1]!));
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const events = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/events$/);
      if (request.method === 'GET' && events) {
        if (!authenticate(request, capabilities)) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        const documentId = decodeURIComponent(events[1]!);
        const rawCursor = request.headers['last-event-id'];
        if (Array.isArray(rawCursor) || (rawCursor !== undefined && !/^\d+$/.test(rawCursor)))
          return json(response, 400, { ok: false, code: 'VALIDATION' });
        const cursor = rawCursor === undefined ? 0 : Number(rawCursor);
        if (!Number.isSafeInteger(cursor)) return json(response, 400, { ok: false, code: 'VALIDATION' });
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-store' });
        const set = subscribers.get(documentId) ?? new Set<ServerResponse>(); set.add(response); subscribers.set(documentId, set);
        for (const event of store!.readEvents(documentId, cursor)) publish(new Set([response]), event);
        response.write(': connected\n\n');
        request.on('close', () => { set.delete(response); }); return;
      }
      json(response, 404, { ok: false });
    } catch { json(response, 400, { ok: false, code: 'VALIDATION' }); }
  });
  const host = options.host ?? '127.0.0.1';
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve); }); }
  catch (error) { store.close(); await lock.release(); throw error; }
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('SERVICE_ADDRESS_INVALID');
  let shutdown: Promise<void> | undefined;
  const close = (releaseLock: boolean): Promise<void> => shutdown ??= (async () => {
    for (const set of subscribers.values()) for (const subscriber of set) subscriber.end();
    for (const set of reviewSubscribers.values()) for (const subscriber of set) subscriber.end();
    server.closeAllConnections(); await closeServer(server); store.close(); if (releaseLock) await lock.release();
  })();
  void lock.lost.then(() => close(false));
  return { url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`, store,
    lockHolderPid: lock.holderPid, close: () => close(true) };
}

function publish(subscribers: Set<ServerResponse> | undefined, event: CommitMetadata): void {
  for (const response of subscribers ?? []) response.write(`id: ${event.commitSeq}\nevent: commit\ndata: ${canonicalJson(event).trim()}\n\n`);
}
function publishReview(subscribers: Set<ServerResponse> | undefined, event: ReviewEvent): void {
  for (const response of subscribers ?? []) response.write(`id: ${event.reviewSeq}\nevent: review\ndata: ${canonicalJson(event).trim()}\n\n`);
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(canonicalJson(value));
}
async function readJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) throw new Error('BODY_TOO_LARGE'); }
  return JSON.parse(body);
}
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
function parseNonnegative(value: string | null, fallback: number): number | null { if (value === null) return fallback;
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function parsePositive(value: string | null, fallback: number): number | null { const parsed = parseNonnegative(value, fallback);
  return parsed !== null && parsed > 0 ? parsed : null; }
function commandFailure(code: CommandFailure['code'], diagnosticCode: string,
  category: CommandFailure['diagnostic']['category'], retryable: boolean, fieldPath?: string): CommandFailure {
  return { ok: false, code, diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: diagnosticCode, category, retryable,
    ...(fieldPath ? { fieldPath } : {}) } };
}
