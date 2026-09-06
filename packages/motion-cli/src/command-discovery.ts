import { workflowExamples, recoveryHelp } from './command-examples.ts';
export const operationKinds = [
  'motion.track.create', 'motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.keyframe.add',
  'motion.keyframe.remove', 'motion.slot-duration.set', 'motion.binding-delay.set', 'motion.slot-easing.set',
  'motion.hold.insert', 'motion.transform-pose.set', 'motion.transform-waypoints.translate',
  'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
  'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
  'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
  'motion.history.undo', 'motion.history.redo', 'motion.branch.create', 'motion.claim.acquire',
  'motion.claim.renew', 'motion.claim.release', 'motion.claim.revoke',
] as const;

export const mutationNames: Record<string, (typeof operationKinds)[number]> = {
  'track-create': 'motion.track.create', 'keyframe-value-set': 'motion.keyframe-value.set',
  'keyframe-time-set': 'motion.keyframe-time.set', 'keyframe-add': 'motion.keyframe.add',
  'keyframe-remove': 'motion.keyframe.remove', 'slot-duration-set': 'motion.slot-duration.set',
  'binding-delay-set': 'motion.binding-delay.set', 'slot-easing-set': 'motion.slot-easing.set',
  'hold-insert': 'motion.hold.insert', 'pose-set': 'motion.transform-pose.set',
  'waypoints-translate': 'motion.transform-waypoints.translate', 'moment-time-set': 'motion.keyframe-group-time.set',
  'waypoint-add': 'motion.transform-waypoint.add', 'waypoint-remove': 'motion.transform-waypoint.remove',
  'segment-easing-set': 'motion.keyframe-group-easing.set', 'settled-hold-set': 'motion.settled-hold.set',
  'cue-create': 'motion.cue.create', 'cue-update': 'motion.cue.update', 'cue-delete': 'motion.cue.delete',
  'cue-detach': 'motion.cue.detach', undo: 'motion.history.undo', redo: 'motion.history.redo',
  'branch-create': 'motion.branch.create', 'claim-acquire': 'motion.claim.acquire',
  'claim-renew': 'motion.claim.renew', 'claim-release': 'motion.claim.release', 'claim-revoke': 'motion.claim.revoke',
};

const readNames = ['project', 'shots', 'context', 'workspace', 'head', 'branches', 'claims', 'activity', 'history', 'export-proof', 'export'] as const;
const baseOptions = ['--shot or --document-id when multiple shots exist', '--branch-id when not main'] as const;
export const commandDiscovery = {
  schemaVersion: 'motion.cli-command-list.v1',
  reads: readNames.map((name) => ({ name, requiredOptions: baseOptions })),
  context: { default: 'managed agent session in this checkout', optionalOptions: ['--project', '--data-dir', '--shot', '--document-id', '--branch-id'],
    explicitTransport: ['--service', '--capability', '--actor'], ambiguity: 'Select --project or --shot explicitly; no implicit retargeting.',
    claims: '--claim <private-handle>; acquire, renew and release explicitly with operation ID and expected revision.' },
  units: { time: '--*-seconds replaces --*-ms exactly (millisecond precision)', position: '--translate-x-pixels / --translate-y-pixels replace microunits exactly',
    translation: '--delta-x-pixels / --delta-y-pixels replace ppm with explicit viewport; inexact values are rejected' },
  guide: 'docs/agent-cli.md', examples: workflowExamples, recovery: recoveryHelp,
  workflow: ['context', 'project', 'workspace', 'claim-acquire', 'track-create', 'head', 'claim-renew', 'claim-release'],
  projectMutations: [{ name: 'shot-admit', kind: 'motion.shot.admit' }],
  reviews: ['review-dispatch', 'review-annotations', 'review-compare', 'review-handoff'].map((name) => ({ name })),
  utilities: [
    { name: 'projects', requiredOptions: [], optionalOptions: ['--data-dir'] },
    { name: 'operation-kinds', requiredOptions: [] },
    { name: 'validate', requiredOptions: [...baseOptions, '--command-file'] },
    { name: 'dispatch', requiredOptions: [...baseOptions, '--command-file'] },
    { name: 'claim-secret', requiredOptions: [] },
  ],
  mutations: Object.entries(mutationNames).map(([name, kind]) => ({ name, kind,
    requiredOptions: mutationRequiredOptions(kind),
    construction: 'service-discovery-and-options',
  })),
} as const;


export function isPreparableOperation(kind: (typeof operationKinds)[number]): boolean {
  return ['motion.transform-pose.set', 'motion.transform-waypoints.translate', 'motion.transform-waypoint.add',
    'motion.transform-waypoint.remove', 'motion.keyframe-group-time.set',
    'motion.keyframe-group-easing.set', 'motion.settled-hold.set', 'motion.cue.create', 'motion.cue.update',
    'motion.cue.delete', 'motion.cue.detach'].includes(kind);
}

function mutationRequiredOptions(kind: (typeof operationKinds)[number]): string[] {
  const identity = [...baseOptions, '--operation-id', '--expected-revision'];
  const common = kind === 'motion.claim.revoke'
    ? [...identity, '--service', '--capability', '--actor human'] : [...identity, '--claim (managed session)'];
  if (kind === 'motion.transform-pose.set') return [...common, '--element-id', '--moment-ms', '--translate-x-microunits',
    '--translate-y-microunits', '--scale-ppm', '--rotate-microdegrees', '--viewport-width', '--viewport-height'];
  if (kind === 'motion.transform-waypoints.translate') return [...common, '--element-id (repeatable)', '--moment-ms',
    '--delta-x-ppm', '--delta-y-ppm', '--viewport-width', '--viewport-height'];
  if (kind === 'motion.transform-waypoint.add' || kind === 'motion.transform-waypoint.remove') {
    return [...common, '--element-id (repeatable)', '--time-ms'];
  }
  if (kind === 'motion.keyframe-group-time.set') return [...common, '--element-id (repeatable)', '--source-time-ms',
    '--target-time-ms', '--landing-time-ms', '--settled-time-ms'];
  if (kind === 'motion.keyframe-group-easing.set') return [...common, '--element-id (repeatable)', '--moment-ms',
    '--expected-easing', '--easing'];
  if (kind === 'motion.settled-hold.set') return [...common, '--element-id (repeatable)', '--source-time-ms',
    '--settled-time-ms', '--landing-time-ms', '--boundary-time-ms'];
  if (kind === 'motion.cue.create') return [...common, '--creation-key', '--semantic', 'semantic options'];
  if (kind === 'motion.cue.update') return [...common, '--cue-id', '--semantic', 'semantic options'];
  if (kind === 'motion.cue.delete' || kind === 'motion.cue.detach') return [...common, '--cue-id'];
  if (kind === 'motion.branch.create') return [...common, '--new-branch-id'];
  if (kind === 'motion.claim.acquire') return [...common, '--scope'];
  if (kind === 'motion.claim.renew' || kind === 'motion.claim.release')
    return [...common, '--lease-version'];
  if (kind === 'motion.claim.revoke') return [...common, '--claim-id', '--lease-version'];
  if (kind === 'motion.track.create') return [...common, '--element-id'];
  if (kind === 'motion.hold.insert') return [...common, '--cue-id', '--duration-ms'];
  if (kind === 'motion.keyframe-value.set') return [...common, '--track-id', '--keyframe-id', '--value'];
  if (kind === 'motion.keyframe-time.set') return [...common, '--track-id', '--keyframe-id', '--time-ms'];
  if (kind === 'motion.keyframe.add') return [...common, '--track-id', '--time-ms', '--value'];
  if (kind === 'motion.keyframe.remove') return [...common, '--track-id', '--keyframe-id'];
  if (kind === 'motion.slot-duration.set') return [...common, '--track-id', '--duration-ms'];
  if (kind === 'motion.binding-delay.set') return [...common, '--track-id', '--delay-ms'];
  if (kind === 'motion.slot-easing.set') return [...common, '--track-id', '--easing'];
  return common;
}

export function commandDetail(name: string): unknown | null {
  if (name === 'export') return { schemaVersion: 'motion.cli-command.v1', name, category: 'read',
    requiredOptions: [...baseOptions, '--expected-revision', '--output FILE.zip'], optionalOptions: ['--project-id'],
    output: 'Standalone animation.html, animation.css and receipt.json in a deterministic ZIP; stdout contains only the receipt and archive digest.',
    safety: 'Exports only the selected committed revision. Existing output files are never replaced. No authoring claim is required.',
    example: 'npm run motion -- export --document-id DOCUMENT_ID --expected-revision REVISION --output /path/to/animation.zip' };
  if (name === 'shot-admit') return { schemaVersion: 'motion.cli-command.v1', name, category: 'mutation',
    kind: 'motion.shot.admit', requiredOptions: ['--project-id', '--expected-catalog-revision', '--document-id', '--name', '--operation-id', '--claim', '--starter or --html-file'],
    starters: ['trajectory', 'reusable-cues'], source: 'One standalone HTML/CSS document, imported atomically with explicit inventories.',
    recovery: 'Repeat the identical source, operation, expected catalog revision and handle. The admitted document claim is kept privately.' };

  if (name === 'projects') return { schemaVersion: 'motion.cli-command.v1', name, category: 'utility', requiredOptions: [], optionalOptions: ['--data-dir'],
    example: 'npm run motion -- projects', output: 'Open project names in this checkout; pass --project to select exactly.' };
  if (name === 'claim-secret') return { schemaVersion: 'motion.cli-command.v1', name, category: 'utility', requiredOptions: [],
    output: 'One fresh secret on stdout for explicit transport only. Managed claims keep secrets private.' };
  if (name.startsWith('review-') && ['review-dispatch', 'review-annotations', 'review-compare', 'review-handoff'].includes(name))
    return { schemaVersion: 'motion.cli-command.v1', name, category: 'review',
      requiredOptions: name === 'review-dispatch' || name === 'review-handoff' ? ['--command-file']
        : name === 'review-compare' ? ['--left-revision', '--right-revision'] : [],
      contextOptions: ['--shot', '--document-id', '--branch-id', '--project', '--data-dir'],
      ...(name === 'review-dispatch' ? { managedRequiredOptions: ['--claim'] } : {}),
      input: name === 'review-dispatch' ? 'review.operation.v1 command file' : name === 'review-handoff' ? 'review.handoff-identity.v1 request file with operationId' : undefined };

  if ((readNames as readonly string[]).includes(name)) return {
    schemaVersion: 'motion.cli-command.v1', name, category: 'read', requiredOptions: baseOptions,
    output: 'Validated service projection; use stable IDs and current revisions from this response.',
  };
  if (name === 'operation-kinds') return { schemaVersion: 'motion.cli-command.v1', name,
    category: 'utility', requiredOptions: [], output: 'motion.operation-kind-list.v1' };
  if (name === 'validate' || name === 'dispatch') return { schemaVersion: 'motion.cli-command.v1', name,
    category: 'utility', requiredOptions: [...baseOptions, '--claim (managed session)', '--command-file'], input: 'motion.protocol.v1 command file' };
  const kind = mutationNames[name]; if (!kind) return null;
  return { schemaVersion: 'motion.cli-command.v1', name, kind, category: 'mutation',
    requiredOptions: mutationRequiredOptions(kind),
    ...(kind === 'motion.track.create' ? { optionalOptions: ['--duration-seconds', '--delay-seconds', '--start-value', '--end-value'],
      validationOptions: ['--validate', '--validate-only'], defaults: { durationSeconds: 1, delaySeconds: 0.61, startValue: 0, endValue: 1 } } : {}),
    ...(kind === 'motion.hold.insert' ? { description: 'Pause the whole shot at the selected existing timeline cue.' } : {}),
    construction: 'service-discovery-and-options', stableIdsFrom: ['workspace', 'claims'],
    ...(isPreparableOperation(kind) ? { preparation: 'MotionServiceClient.prepareOperation',
      dispatch: 'motion.operation-intent.v1', optionalOptions: ['--validate', '--validate-only'],
      valueFormats: { easing: 'keyword:<value> | steps:<count>:<position> | cubic-bezier:<x1>:<y1>:<x2>:<y2>',
        reveal: '--semantic reveal --target-id <id> (repeatable) --start-ms <n> --complete-ms <n>',
        cursorPath: '--semantic cursor-path --cursor-target-id <id> --start-ms <n> --arrive-ms <n> --easing <format> --waypoint <time:xPpm:yPpm> (repeatable)',
        type: '--semantic type --target-id <id> --start-seconds <n> --complete-seconds <n> --step-count <n>',
        select: '--semantic select --cursor-target-id <id> --selected-target-id <id> [--highlight-target-id <id>] --approach-seconds <n> --choose-seconds <n> --settle-seconds <n>',
        drag: '--semantic drag --cursor-target-id <id> --dragged-target-id <id> --approach-seconds <n> --press-seconds <n> --move-start-seconds <n> --arrive-seconds <n> --release-seconds <n> --grab-offset-x-ppm <n> --grab-offset-y-ppm <n> --waypoint <timeMs:xPpm:yPpm> (repeatable)',
        hold: '--semantic hold --target-id <id> (repeatable) --enter-seconds <n> --duration-seconds <n> --exit-seconds <n>',
        click: '--semantic click --cursor-target-id <id> --pulse-target-id <id> --arrive-ms <n> --press-ms <n> --release-ms <n> --pulse-end-ms <n> --press-scale-ppm <n> --pulse-radius-ppm <n> --pulse-opacity-ppm <n> [--reveal-cue-id <id>]',
      } } : {}),
  };
}
