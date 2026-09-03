import { sha256Hex } from '../../../packages/domain/src/index.ts';
import { ReviewServiceClient, type AnnotationList, type ReviewCommand,
  type RevisionComparison } from '../../../packages/motion-protocol/src/review.ts';
import { REVIEW_SERIALIZER_VERSION, type HandoffReceipt } from '../../../packages/review-domain/src/index.ts';

export type ReviewInspector = {
  annotations: AnnotationList | null; comparison: RevisionComparison | null; handoff: HandoffReceipt | null;
  actionKinds: string[]; bodyRetainedInDom: false;
};

export function mountReviewHandoff(options: { root: HTMLElement; serviceUrl: string; capability: string;
  documentId: string; branchId: () => string; revision: () => number; canonicalDigest: () => string;
  compiled: () => { html: string; css: string; exportDigest: string } }): { inspect(): ReviewInspector; refresh(): Promise<void> } {
  const client = new ReviewServiceClient(options.serviceUrl, (...args) => fetch(...args),
    { actor: 'human', capability: options.capability });
  let annotations: AnnotationList | null = null; let comparison: RevisionComparison | null = null;
  let handoff: HandoffReceipt | null = null; const actionKinds: string[] = [];
  const section = document.createElement('section'); section.className = 'review-handoff'; section.dataset.reviewHandoff = '';
  section.innerHTML = `<header><div><p class="eyebrow">Revision review</p><h2>Annotations &amp; handoff</h2></div>
    <output data-review-status role="status">Ready</output></header>
    <form data-review-form><label>Annotation ID<input name="annotationId" value="annotation-1" required></label>
      <label>Private annotation<textarea name="body" required></textarea></label>
      <div class="review-actions"><button name="action" value="create">Create</button><button name="action" value="edit">Edit</button>
      <button name="action" value="resolve">Resolve</button><button name="action" value="reopen">Reopen</button>
      <button name="action" value="delete">Delete</button></div></form>
    <ol data-review-annotations></ol>
    <form data-compare-form><label>Left revision<input name="left" type="number" min="0" value="0"></label>
      <label>Right revision<input name="right" type="number" min="0" value="0"></label><button>Compare immutable revisions</button></form>
    <output data-comparison></output><button type="button" data-create-handoff disabled>Create sanitized handoff</button>
    <output data-handoff></output>`;
  options.root.append(section);
  const status = section.querySelector<HTMLOutputElement>('[data-review-status]')!;
  const render = () => { const list = section.querySelector<HTMLOListElement>('[data-review-annotations]')!; list.replaceChildren();
    for (const item of annotations?.annotations ?? []) { const row = document.createElement('li');
      row.textContent = `${item.annotationId} · v${item.version} · ${item.state} · anchored r${item.anchorRevision}`; list.append(row); }
    section.querySelector<HTMLOutputElement>('[data-comparison]')!.value = comparison
      ? `r${comparison.left.revision} ↔ r${comparison.right.revision} · ${comparison.changed ? 'changed' : 'identical'}` : '';
    section.querySelector<HTMLButtonElement>('[data-create-handoff]')!.disabled = !comparison;
    section.querySelector<HTMLOutputElement>('[data-handoff]')!.value = handoff ? `Handoff ${handoff.handoffDigest}` : ''; };
  const refresh = async () => { annotations = await client.annotations(options.documentId, options.branchId()); render(); };
  section.querySelector<HTMLFormElement>('[data-review-form]')!.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const submitter = (event as SubmitEvent).submitter as HTMLButtonElement;
    const data = new FormData(form); const annotationId = String(data.get('annotationId')); const action = submitter.value;
    const existing = annotations?.annotations.find((item) => item.annotationId === annotationId);
    const common = { schemaVersion: 'review.operation.v1' as const, operationId: `review-${crypto.randomUUID()}`,
      documentId: options.documentId, branchId: options.branchId(), expectedBranchRevision: options.revision(), annotationId,
      expectedAnnotationVersion: existing?.version ?? 0 };
    const command = (action === 'create' ? { ...common, kind: 'review.annotation.create', anchorRevision: options.revision(),
      body: String(data.get('body')) } : action === 'edit' ? { ...common, kind: 'review.annotation.edit', body: String(data.get('body')) }
      : { ...common, kind: `review.annotation.${action}` }) as ReviewCommand;
    const response = await client.dispatch(command); (form.elements.namedItem('body') as HTMLTextAreaElement).value = '';
    status.value = response.ok ? `${command.kind} stored without changing motion revision.` : response.diagnostic.code;
    if (response.ok) actionKinds.push(command.kind); await refresh();
  });
  section.querySelector<HTMLFormElement>('[data-compare-form]')!.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); comparison = await client.compare(options.documentId,
      Number(data.get('left')), Number(data.get('right'))); status.value = 'Immutable comparison loaded.'; render();
  });
  section.querySelector<HTMLButtonElement>('[data-create-handoff]')!.addEventListener('click', async () => {
    if (!comparison) return; const current = options.compiled();
    handoff = await client.handoff({ operationId: `handoff-${crypto.randomUUID()}`, schemaVersion: 'review.handoff-identity.v1',
      serializerVersion: REVIEW_SERIALIZER_VERSION, documentId: options.documentId, branchId: options.branchId(),
      revision: options.revision(), canonicalDigest: options.canonicalDigest(), comparisonRecords: [{
        schemaVersion: 'review.comparison-identity.v1',
        leftRevision: comparison.left.revision, leftCanonicalDigest: comparison.left.canonicalDigest,
        rightRevision: comparison.right.revision, rightCanonicalDigest: comparison.right.canonicalDigest }], proofRecords: [{
        schemaVersion: 'review.proof-identity.v1',
        revision: options.revision(), canonicalDigest: options.canonicalDigest(), htmlDigest: sha256Hex(current.html),
        cssDigest: sha256Hex(current.css), exportDigest: current.exportDigest }], benchmarkRecords: [] });
    status.value = 'Sanitized deterministic handoff ready.'; render();
  });
  void refresh();
  return { inspect: () => structuredClone({ annotations, comparison, handoff, actionKinds, bodyRetainedInDom: false }), refresh };
}
