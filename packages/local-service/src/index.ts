import { createServer, type Server, type ServerResponse } from 'node:http';

import { canonicalJson, type MotionDocument } from '../../domain/src/index.ts';
import { parseCommand, type CommitMetadata } from '../../motion-protocol/src/index.ts';
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
  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true });
      if (request.method === 'POST' && url.pathname === '/api/v1/commands') {
        const parsed = parseCommand(await readJson(request));
        if (!parsed.ok) return json(response, parsed.code === 'UNSUPPORTED_VERSION' ? 400 : 422, parsed);
        const auth = authenticate(request, capabilities);
        if (!auth) return json(response, 403, { ok: false, code: 'UNAUTHORIZED_CLAIM' });
        let result;
        try { result = store!.execute(parsed.command, { ...auth, now: options.now?.() ?? Date.now() }); }
        catch { return json(response, 500, { ok: false, code: 'STORAGE_FAILURE' }); }
        if ('event' in result && !result.replayed) publish(subscribers.get(result.event.documentId), result.event);
        return json(response, result.response.ok ? 200 : result.response.code === 'STALE_REVISION' ? 409
          : result.response.code === 'UNAUTHORIZED_CLAIM' ? 403 : 422, result.response);
      }
      const head = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/(?:branches\/([^/]+)\/)?head$/);
      if (request.method === 'GET' && head) {
        const found = store!.readHead(decodeURIComponent(head[1]!), head[2] ? decodeURIComponent(head[2]) : undefined);
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const revision = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/revisions\/(\d+)$/);
      if (request.method === 'GET' && revision) {
        const found = store!.readRevision(decodeURIComponent(revision[1]!), Number(revision[2]));
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const documentRevision = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/revision$/);
      if (request.method === 'GET' && documentRevision) {
        const found = (store as SqliteProjectStore).readDocumentRevision(decodeURIComponent(documentRevision[1]!));
        return json(response, found ? 200 : 404, found ?? { ok: false });
      }
      const events = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/events$/);
      if (request.method === 'GET' && events) {
        const documentId = decodeURIComponent(events[1]!);
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-store' });
        response.write(': connected\n\n');
        const set = subscribers.get(documentId) ?? new Set<ServerResponse>(); set.add(response); subscribers.set(documentId, set);
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
    server.closeAllConnections(); await closeServer(server); store.close(); if (releaseLock) await lock.release();
  })();
  void lock.lost.then(() => close(false));
  return { url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`, store,
    lockHolderPid: lock.holderPid, close: () => close(true) };
}

function publish(subscribers: Set<ServerResponse> | undefined, event: CommitMetadata): void {
  for (const response of subscribers ?? []) response.write(`event: commit\ndata: ${canonicalJson(event).trim()}\n\n`);
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
