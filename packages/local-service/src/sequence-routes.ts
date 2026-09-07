import type { IncomingMessage, ServerResponse } from 'node:http';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { sequenceCommandSchema, sequenceReadRequestSchema } from '../../motion-protocol/src/sequence.ts';
import { compileSequence } from '../../css-compiler/src/sequence-compiler.ts';
import type { ProjectStore } from '../../project-store/src/index.ts';
import { authenticate, type ServiceCapabilities } from './auth.ts';
import { resolveSequenceSources } from './sequence-sources.ts';
import { certifySequenceViewport } from '../../css-compiler/src/sequence-viewport.ts';

export async function sequenceRoute(request: IncomingMessage, response: ServerResponse, url: URL,
  store: ProjectStore, capabilities: ServiceCapabilities, now: number): Promise<boolean> {
  if (!url.pathname.startsWith('/api/sequence/v1/')) return false;
  const reply = (status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(canonicalJson(value)); return true;
  };
  const auth = authenticate(request, capabilities);
  if (!auth) return reply(403, { ok: false, code: 'SEQUENCE_UNAUTHORIZED' });
  if (request.method === 'GET' && url.pathname === '/api/sequence/v1/catalog') return reply(200, store.listSequences(now));
  if (request.method === 'GET' && url.pathname === '/api/sequence/v1/sources') {
    const catalog = store.readProjectCatalog();
    return reply(200, { schemaVersion: 'motion.sequence-sources.v1', projectId: catalog.projectId, shots: catalog.shots.map(shot => {
      const source = { documentId: shot.documentId, revision: shot.headRevision,
        canonicalDigest: shot.canonicalDigest, durationMs: shot.durationMs };
      const document = store.readRevision(source.documentId, source.revision)?.document;
      let viewport = null; let reasonCode = null;
      try {
        if (!document) throw new Error('SEQUENCE_SOURCE_MISSING');
        if (source.durationMs <= 0) throw new Error('SEQUENCE_SOURCE_DURATION_INVALID');
        viewport = certifySequenceViewport(document);
        compileSequence({ schemaVersion: 'motion.sequence.v1', projectId: catalog.projectId, sequenceId: 'eligibility',
          revision: 0, name: 'Eligibility', viewport, finalState: 'last-shot-native-end',
          reducedMotion: 'source-snapshots-with-hard-cuts', clips: [{ clipId: 'candidate', name: 'Candidate', source, endHoldMs: 0 }] }, [document]);
      } catch (error) {
        viewport = null;
        const code = error instanceof Error ? error.message : '';
        reasonCode = /^SEQUENCE_[A-Z0-9_]{1,70}$/.test(code) ? code : 'SEQUENCE_SOURCE_UNSUPPORTED';
      }
      return { name: shot.name, source, viewport, reasonCode };
    }) });
  }
  const sequence = url.pathname.match(/^\/api\/sequence\/v1\/sequences\/([A-Za-z0-9_-]{1,128})$/);
  if (request.method === 'GET' && sequence) {
    const result = store.readSequence(sequence[1]!, now);
    return reply(result ? 200 : 404, result ?? { ok: false, code: 'SEQUENCE_NOT_FOUND' });
  }
  if (request.method === 'POST' && url.pathname === '/api/sequence/v1/commands') {
    let command; try { command = sequenceCommandSchema.parse(await readJson(request)); }
    catch { return reply(422, { ok: false, code: 'SEQUENCE_INVALID' }); }
    let result;
    try { result = store.executeSequence(command, { ...auth, now }); }
    catch { return reply(500, { ok: false, code: 'SEQUENCE_STORAGE_FAILURE' }); }
    return reply(result.ok ? 200 : result.code === 'SEQUENCE_STALE_REVISION' ? 409
      : result.code === 'SEQUENCE_UNAUTHORIZED' ? 403 : 422, result);
  }
  if (request.method === 'POST' && url.pathname === '/api/sequence/v1/export') {
    let input; try { input = sequenceReadRequestSchema.parse(await readJson(request)); }
    catch { return reply(422, { ok: false, code: 'SEQUENCE_INVALID' }); }
    if (input.projectId !== store.readProjectCatalog().projectId) return reply(422, { ok: false, code: 'SEQUENCE_PROJECT_MISMATCH' });
    const snapshot = store.readSequence(input.sequenceId, now);
    if (!snapshot) return reply(404, { ok: false, code: 'SEQUENCE_NOT_FOUND' });
    if (snapshot.sequence.revision !== input.expectedRevision)
      return reply(409, { ok: false, code: 'SEQUENCE_STALE_REVISION', currentRevision: snapshot.sequence.revision });
    if (!snapshot.sequence.clips.length) return reply(422, { ok: false, code: 'SEQUENCE_EMPTY' });
    try {
      const compiled = compileSequence(snapshot.sequence, resolveSequenceSources(store, snapshot.sequence));
      return reply(200, { ok: true, schemaVersion: 'motion.sequence-export.v1', ...compiled });
    } catch { return reply(422, { ok: false, code: 'SEQUENCE_SOURCE_UNSUPPORTED' }); }
  }
  return reply(404, { ok: false, code: 'SEQUENCE_NOT_FOUND' });
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length; if (length > 1_000_000) throw new Error('BODY_TOO_LARGE'); chunks.push(bytes);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
}
