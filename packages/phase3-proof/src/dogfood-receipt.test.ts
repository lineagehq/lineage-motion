import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { runCli } from '../../motion-cli/src/cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

type CliResult = { code: number; value: Record<string, unknown> };
type StableRun = {
  revision: number;
  canonicalDigest: string;
  operationDigest: string;
  compiler: { htmlDigest: string; cssDigest: string; exportDigest: string; reducedMotionDigest: string };
  counts: { ruleCount: number; applicationCount: number; slotCount: number; trackCount: number };
};

async function invoke(args: string[]): Promise<CliResult> {
  let stdout = ''; let stderr = '';
  const code = await runCli(args, { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
  expect(stderr).toBe('');
  return { code, value: JSON.parse(stdout) as Record<string, unknown> };
}

async function runServiceOnlyAgentWorkflow(): Promise<StableRun> {
  const temporary = await temporaryStore(); const seed = phase3Seed();
  const capabilities = { human: randomBytes(32).toString('base64url'), agent: randomBytes(32).toString('base64url') };
  const secret = randomBytes(32).toString('base64url');
  let service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, capabilities });
  const common = ['--service', service.url, '--document-id', seed.documentId, '--actor', 'agent',
    '--capability', capabilities.agent];
  const workspace = await invoke(['workspace', ...common]); expect(workspace.code).toBe(0);
  const projection = workspace.value as { revision: number; tracks: Array<{ trackId: string; ruleId: string; property: string }>;
    rules: Array<{ ruleId: string; tracks: Array<{ property: string; keyframes: Array<{
      keyframeId: string; value: { kind: string; value: number } | null }> }> }> };
  const track = projection.tracks.find((candidate) => candidate.property === 'opacity');
  const frame = track ? projection.rules.find((rule) => rule.ruleId === track.ruleId)?.tracks
    .find((candidate) => candidate.property === track.property)?.keyframes.find((candidate) => candidate.value?.kind === 'number') : undefined;
  if (!track || !frame?.value) throw new Error('PUBLIC_WORKSPACE_WRITABLE_TARGET_MISSING');
  const claim = await invoke(['claim-acquire', ...common, '--operation-id', 'dogfood-agent-claim',
    '--expected-revision', String(projection.revision), '--scope', 'document', '--claim-secret', secret]);
  expect(claim.code).toBe(0);
  const mutation = await invoke(['keyframe-value-set', ...common, '--operation-id', 'dogfood-agent-mutation',
    '--expected-revision', String(projection.revision), '--track-id', track.trackId,
    '--keyframe-id', frame.keyframeId, '--value', String(frame.value.value + 0.01), '--claim-secret', secret]);
  expect(mutation.code).toBe(0);
  const mutationValue = mutation.value as { resultingRevision: number; canonicalDigest: string; operationDigest: string };
  await service.close();
  service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, capabilities });
  const proof = await invoke(['export-proof', '--service', service.url, '--document-id', seed.documentId,
    '--actor', 'agent', '--capability', capabilities.agent]);
  expect(proof.code).toBe(0);
  const exported = proof.value as StableRun['compiler'] & { revision: number; canonicalDigest: string; counts: StableRun['counts'] };
  expect(exported.revision).toBe(mutationValue.resultingRevision);
  expect(exported.canonicalDigest).toBe(mutationValue.canonicalDigest);
  await service.close(); await temporary.cleanup();
  return { revision: exported.revision, canonicalDigest: exported.canonicalDigest,
    operationDigest: mutationValue.operationDigest, compiler: { htmlDigest: exported.htmlDigest,
      cssDigest: exported.cssDigest, exportDigest: exported.exportDigest,
      reducedMotionDigest: exported.reducedMotionDigest }, counts: exported.counts };
}

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sort(nested)])) : item;
  return `${JSON.stringify(sort(value))}\n`;
}

describe('sanitized dogfood aggregate receipt', () => {
  test('proves three stable service-only CLI compiler/export/revision digest runs without private evidence', async () => {
    const runs = [await runServiceOnlyAgentWorkflow(), await runServiceOnlyAgentWorkflow(),
      await runServiceOnlyAgentWorkflow()];
    expect(canonical(runs[1])).toBe(canonical(runs[0])); expect(canonical(runs[2])).toBe(canonical(runs[0]));
    const runDigests = runs.map((run) => createHash('sha256').update(canonical(run)).digest('hex'));
    expect(new Set(runDigests).size).toBe(1);
    const receipt = { schemaVersion: 'motion.dogfood-aggregate-receipt.v1', repeatedRunDigests: runDigests,
      stable: true, revision: runs[0]!.revision, canonicalDigest: runs[0]!.canonicalDigest,
      operationDigest: runs[0]!.operationDigest, compiler: runs[0]!.compiler, counts: runs[0]!.counts,
      privacy: { privateCorpusConsumed: false, presentationContentIncluded: false, selectorIncluded: false,
        localPathIncluded: false, urlIncluded: false, credentialIncluded: false, operationIdIncluded: false,
        timestampIncluded: false, screenshotIncluded: false } };
    const bytes = canonical(receipt); const bannedKeys = ['capability', 'credential', 'token', 'secret', 'operationId',
      'timestamp', 'databasePath', 'sourcePath', 'url', 'selector', 'screenshot'];
    for (const key of bannedKeys) expect(Object.keys(receipt).includes(key)).toBe(false);
    expect(bytes).not.toMatch(/https?:\/\//); expect(bytes).not.toContain('localhost'); expect(bytes).not.toContain('file:');
    expect(bytes).not.toContain('dogfood-agent-'); expect(bytes).not.toContain('el_'); expect(bytes).not.toContain('#');
    expect(receipt).toMatchObject({ stable: true, revision: 1, privacy: {
      privateCorpusConsumed: false, presentationContentIncluded: false, selectorIncluded: false,
      localPathIncluded: false, urlIncluded: false, credentialIncluded: false, operationIdIncluded: false,
      timestampIncluded: false, screenshotIncluded: false,
    } });
  });
});
