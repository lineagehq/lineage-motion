import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import type { Options } from './arguments.ts';
import { sessionFetch } from './session-context.ts';
export async function resolveProject(name: string, options: Options): Promise<unknown | undefined> {
  if (name === 'context') {
    if (!options.session) throw new Error('CLI_MANAGED_SESSION_REQUIRED');
    return { schemaVersion: 'motion.cli-context.v1', project: options.session.project,
      ...(options.session.projectId ? { projectId: options.session.projectId } : {}), actor: 'agent', branchId: options.branchId };
  }
  if (!options.session && name !== 'project' && name !== 'shots') return undefined;
  // Explicit IDs never change as the catalog grows. An omitted selector is safe only for a single shot.
  if (options.documentId && name !== 'project' && name !== 'shots') return undefined;
  const catalog = await new ProjectServiceClient(options.service, { actor: options.actor, capability: options.capability },
    options.session ? sessionFetch : fetch).catalog();
  if (options.session && (options.session.projectId ? catalog.projectId !== options.session.projectId : catalog.name !== options.session.project)) throw new Error('CLI_PROJECT_MISMATCH');
  if (name === 'project' || name === 'shots') return catalog;
  const selector = options.read('--shot');
  const byId = selector ? catalog.shots.filter((shot) => shot.documentId === selector) : [];
  const choices = selector ? byId.length ? byId : catalog.shots.filter((shot) => shot.name === selector) : catalog.shots;
  if (!choices.length) throw new Error('CLI_SHOT_NOT_FOUND');
  if (choices.length !== 1) throw new Error('CLI_SHOT_AMBIGUOUS');
  options.documentId = choices[0]!.documentId;
  return undefined;
}
