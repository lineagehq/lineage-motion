import { ExportServiceClient } from '../../../packages/motion-protocol/src/export.ts';
import { mountShotExport } from './shot-export.ts';
import { authoring, activeBranchId, publicationState, pendingRevision, activeWaypointDraft, captureDraft } from './main.ts';

export function mountProjectExport(root: HTMLElement, projectId: string, capability: string): void {
  const panel = mountShotExport(root.querySelector<HTMLElement>('.preview-panel') ?? root, new ExportServiceClient('', { actor: 'human', capability }), () => ({
    projectId, documentId: authoring.value.document.documentId, branchId: activeBranchId.value,
    expectedRevision: authoring.value.document.revision, saved: publicationState.value === 'settled'
      && pendingRevision.value === null && !captureDraft().dirty && !activeWaypointDraft.value
      && !root.querySelector('[data-project-draft="true"], [data-operation-pending="true"]'),
  }));
  const refresh = () => queueMicrotask(panel.refresh);
  for (const event of ['input', 'change', 'pointerup', 'motion:projection']) document.addEventListener(event, refresh);
  new MutationObserver(panel.refresh).observe(root, { subtree: true, attributes: true,
    attributeFilter: ['data-project-draft', 'data-operation-pending', 'data-publication-state'] });
}
