import type { ActorKind } from '../../motion-protocol/src/index.ts';
import { loadSession, type SessionContext } from './session-context.ts';
import { normalizeUnits } from './units.ts';

export type Options = {
  service: string; actor: ActorKind; capability: string; documentId: string | undefined; branchId: string;
  operationId: string | undefined; expectedRevision: number | undefined; claimSecret: string | undefined;
  commandFile: string | undefined; session?: SessionContext; claim?: string;
  read(name: string): string | undefined; readAll(name: string): string[]; has(name: string): boolean;
  set(name: string, value: string): void;
};
const known = new Set([
  '--name', '--starter', '--html-file', '--project-id', '--expected-catalog-revision', '--start-value', '--end-value',
  '--actor', '--after', '--approach-ms', '--approach-seconds', '--arrive-ms', '--arrive-seconds',
  '--boundary-time-ms', '--boundary-time-seconds', '--branch-id', '--capability', '--choose-ms', '--choose-seconds',
  '--claim', '--claim-id', '--claim-secret', '--command-file', '--complete-ms', '--complete-seconds',
  '--creation-key', '--cue-id', '--cursor-target-id', '--data-dir', '--delay-ms', '--delay-seconds',
  '--delta-x-pixels', '--delta-x-ppm', '--delta-y-pixels', '--delta-y-ppm', '--document-id', '--dragged-target-id',
  '--duration-ms', '--duration-seconds', '--easing', '--element-id', '--enter-ms', '--enter-seconds',
  '--exit-ms', '--exit-seconds', '--expected-easing', '--expected-revision', '--grab-offset-x-ppm', '--grab-offset-y-ppm',
  '--help', '--highlight-target-id', '--keyframe-id', '--landing-time-ms', '--landing-time-seconds', '--lease-version',
  '--left-revision', '--limit', '--moment-ms', '--moment-seconds', '--move-start-ms', '--move-start-seconds',
  '--new-branch-id', '--operation-id', '--press-ms', '--press-scale-ppm', '--press-seconds', '--project',
  '--pulse-end-ms', '--pulse-end-seconds', '--pulse-opacity-ppm', '--pulse-radius-ppm', '--pulse-target-id', '--release-ms',
  '--release-seconds', '--reveal-cue-id', '--right-revision', '--rotate-microdegrees', '--scale-ppm', '--scope',
  '--selected-target-id', '--semantic', '--service', '--settle-ms', '--settle-seconds', '--settled-time-ms',
  '--settled-time-seconds', '--shot', '--source-time-ms', '--source-time-seconds', '--start-ms', '--start-seconds',
  '--step-count', '--target-id', '--target-time-ms', '--target-time-seconds', '--time-ms', '--time-seconds',
  '--track-id', '--translate-x-microunits', '--translate-x-pixels', '--translate-y-microunits', '--translate-y-pixels', '--validate',
  '--validate-only', '--value', '--viewport-height', '--viewport-width', '--waypoint',
]);
const repeatable = new Set(['--element-id', '--target-id', '--waypoint']);
const boolean = new Set(['--validate', '--validate-only']);
export function parseArgumentValues(argv: string[]): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (let index = 1; index < argv.length; index++) {
    const name = argv[index]!;
    if (!known.has(name) || (values.has(name) && !repeatable.has(name))) throw new Error('CLI_OPTIONS_INVALID');
    const value = boolean.has(name) ? 'true' : argv[++index];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error('CLI_OPTIONS_INVALID');
    values.set(name, [...values.get(name) ?? [], value]);
  }
  normalizeUnits(values); return values;
}
export function parseOptions(argv: string[]): Options {
  const values = parseArgumentValues(argv);
  const read = (name: string) => values.get(name)?.[0];
  const readAll = (name: string) => values.get(name) ?? [];
  const has = (name: string) => values.has(name);
  const set = (name: string, value: string) => { values.set(name, [value]); };
  let service = read('--service'); let session: SessionContext | undefined;
  const explicit = service !== undefined;
  if (explicit && (has('--project') || has('--data-dir') || has('--claim') || has('--shot')))
    throw new Error('CLI_CONTEXT_CONFLICT');
  if (!explicit) {
    if (has('--capability') || has('--claim-secret') || has('--actor')) throw new Error('CLI_CONTEXT_CONFLICT');
    session = loadSession(read('--project'), read('--data-dir')); service = session.service;
  }
  const actor = (session ? 'agent' : read('--actor') ?? (argv[0]?.startsWith('claim-') ? 'agent' : 'human')) as ActorKind;
  const capability = session?.capability ?? read('--capability')
    ?? (actor === 'human' ? process.env.MOTION_HUMAN_CAPABILITY : process.env.MOTION_AGENT_CAPABILITY)
    ?? (process.env.VITEST ? actor === 'human' ? 'human-editor' : 'cli-agent' : undefined);
  if (!service || !capability || (actor !== 'human' && actor !== 'agent')) throw new Error('CLI_OPTIONS_INVALID');
  const rawRevision = read('--expected-revision');
  if (rawRevision !== undefined && !/^\d+$/.test(rawRevision)) throw new Error('CLI_OPTIONS_INVALID');
  const expectedRevision = rawRevision === undefined ? undefined : Number(rawRevision);
  if (expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) throw new Error('CLI_OPTIONS_INVALID');
  if (has('--document-id') && has('--shot')) throw new Error('CLI_CONTEXT_CONFLICT');
  return { service, actor, capability, documentId: read('--document-id'), branchId: read('--branch-id') ?? 'main',
    operationId: read('--operation-id'), expectedRevision, claimSecret: read('--claim-secret'),
    commandFile: read('--command-file'), ...(session ? { session } : {}), ...(read('--claim') ? { claim: read('--claim')! } : {}),
    read, readAll, has, set };
}
