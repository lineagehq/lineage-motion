import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readable, resolveShot1CanonicalEasing, resolveShot1ProofAuthority } from './qa-helpers.mjs';

export async function setupLandingShot1({ authority, workspaceSmokeOnly }) {
  const repositoryRoot = resolve(import.meta.dirname, '../../..');
  const publicFixturePath = resolve(repositoryRoot, 'fixtures/public-synthetic/landing-shot1.html');
  const privateManifestPath = resolve(repositoryRoot, '.private-corpus/landing-shot1-approved-reference-v3-r2-manifest.json');
  const privateDirectory = resolve(repositoryRoot, '.motion/private/landing-shot1-canonical-editing');
  const privateDocumentPath = resolve(privateDirectory, 'canonical-document.json');
  if (authority === 'private' && workspaceSmokeOnly
    && !(await readable(privateManifestPath) && await readable(privateDocumentPath))) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'motion.shot1-private-workspace-smoke.v1',
      passed: true,
      outcome: 'deferred',
      diagnosticCodes: ['IMPORT_ALIAS_UNAVAILABLE'],
      trackedPrivateDetails: false,
    })}\n`);
    return { deferred: true };
  }
  if (authority === 'public') {
    await access(publicFixturePath);
    resolveShot1ProofAuthority(authority, { publicFixture: true, privateManifest: false, privateCanonical: false });
  } else {
    await access(privateManifestPath); await access(privateDocumentPath);
    resolveShot1ProofAuthority(authority, { publicFixture: false, privateManifest: true, privateCanonical: true });
  }
  const seed = authority === 'private' ? JSON.parse(await readFile(privateDocumentPath, 'utf8')) : null;
  let targetElementIds = seed?.elements.map((element) => element.id).sort() ?? [];
  if (authority === 'private' && targetElementIds.length !== 2) throw new Error('LANDING_SHOT1_TARGET_COUNT');
  const canonicalEasing = await resolveShot1CanonicalEasing(repositoryRoot, authority, privateDocumentPath);
  if (!canonicalEasing.eligible || canonicalEasing.targetCount !== 2 || canonicalEasing.resolvedCount !== 2) {
    throw new Error('LANDING_SHOT1_CANONICAL_EASING_RESOLUTION_INVALID');
  }
  const directory = await mkdtemp(join(tmpdir(), 'lineage-motion-shot1-qa-'));
  const humanCapability = randomBytes(32).toString('base64url'); const agentCapability = randomBytes(32).toString('base64url');
  const port = 43500 + Math.floor(Math.random() * 300);
  const processHandle = spawn(process.execPath, [resolve(repositoryRoot, 'node_modules/vite-node/vite-node.mjs'), resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, LANDING_SHOT1_WORKSPACE: '1',
      ...(authority === 'private' ? { LANDING_SHOT1_DOCUMENT_PATH: privateDocumentPath } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { deferred: false, repositoryRoot, privateDirectory, privateDocumentPath, targetElementIds, canonicalEasing, directory, port, processHandle };
}
