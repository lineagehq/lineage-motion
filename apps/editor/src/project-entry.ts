import './project-entry.css';
import { ProjectServiceClient } from '../../../packages/motion-protocol/src/project-client.ts';
import type { ProjectCatalog, ShotAdmissionCommand } from '../../../packages/motion-protocol/src/project.ts';

export function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function loadProjectEntry(capability: string, fallbackId: string) {
  const client = new ProjectServiceClient('', { actor: 'human', capability });
  const catalog = await client.catalog();
  const requested = new URLSearchParams(location.search).get('shot');
  const documentId = requested ?? fallbackId;
  if (!catalog.shots.some(shot => shot.documentId === documentId)) throw new Error('EDITOR_SHOT_NOT_FOUND');
  return { client, catalog, documentId };
}

export function mountProjectEntry(options: {
  root: HTMLElement; displayName?: string | null; client: ProjectServiceClient; catalog: ProjectCatalog; documentId: string;
  dirty: () => boolean; pending: () => boolean;
}) {
  let leaving = false; let catalog = options.catalog; let admitting = false; let entryDirty = false; let pendingCommand: ShotAdmissionCommand | null = null; let pendingInput = '';
  const host = document.createElement('section'); host.className = 'project-entry'; host.setAttribute('aria-label', 'Project and shots');
  host.innerHTML = `<div class="project-heading"><div><small>Project</small><h2>${escapeMarkup(options.displayName ?? catalog.name)}</h2></div>
    <label>Current shot<select data-project-shot></select></label></div>
    <details data-new-shot><summary>Create a shot</summary><form data-shot-create>
    <label>Shot name<input name="shotName" required maxlength="120" placeholder="Opening moment"></label>
    <label>Starting point<select name="source"><option value="trajectory">Moving objects starter</option><option value="reusable-cues">Interaction starter</option><option value="html-css">Import HTML and CSS</option></select></label>
    <label data-import-field hidden>Self-contained HTML and CSS<textarea name="html" rows="7" maxlength="900000" placeholder="Paste a complete HTML scene with inline CSS"></textarea></label>
    <p>Supported CSS animations only. Unsupported content is rejected before saving.</p><button type="submit">Create shot</button>
    </form></details><output data-entry-status role="status" aria-live="polite"></output>
    <dialog data-shot-switch><h2>Keep editing this shot?</h2><p>Your unapplied changes will be discarded if you switch shots.</p>
      <button type="button" data-shot-stay>Stay here</button><button type="button" data-shot-discard>Discard changes and switch</button></dialog>`;
  options.root.prepend(host);
  const select = host.querySelector<HTMLSelectElement>('[data-project-shot]')!;
  const form = host.querySelector<HTMLFormElement>('form')!;
  const source = form.elements.namedItem('source') as HTMLSelectElement;
  const html = form.elements.namedItem('html') as HTMLTextAreaElement;
  const feedback = host.querySelector<HTMLOutputElement>('output')!;
  const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
  let destination: string | null = null;
  const render = () => { select.replaceChildren(...catalog.shots.map(shot => {
    const option = new Option(shot.name, shot.documentId); option.selected = shot.documentId === options.documentId; return option;
  })); };
  const navigate = (id: string) => { leaving = true; const url = new URL(location.href); url.search = ''; url.searchParams.set('shot', id); location.assign(url); };
  const switchTo = (id: string) => {
    select.value = options.documentId;
    if (options.pending() || admitting) { feedback.value = 'Wait for the current change to finish before switching shots.'; return; }
    if (options.dirty() || entryDirty) { destination = id; dialog.showModal(); return; }
    navigate(id);
  };
  select.addEventListener('change', () => switchTo(select.value));
  host.querySelector('[data-shot-stay]')!.addEventListener('click', () => { destination = null; dialog.close(); });
  host.querySelector('[data-shot-discard]')!.addEventListener('click', () => {
    if (options.pending() || admitting) { dialog.close(); feedback.value = 'Wait for the current change to finish before switching shots.'; return; }
    if (destination) navigate(destination);
  });
  form.addEventListener('input', () => { entryDirty = true; });
  source.addEventListener('change', () => {
    const importing = source.value === 'html-css'; host.querySelector<HTMLElement>('[data-import-field]')!.hidden = !importing;
    html.required = importing; entryDirty = true;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (admitting || options.pending()) return;
    // Do not create another document while its origin has an unapplied editing draft.
    if (options.dirty()) { feedback.value = 'Apply or discard the current shot’s editing draft before creating a shot.'; return; }
    admitting = true; const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button');
    controls.forEach(control => { control.disabled = true; });
    try {
      const name = (form.elements.namedItem('shotName') as HTMLInputElement).value;
      const selectedSource = source.value === 'html-css' ? { kind: 'html-css' as const, html: html.value }
        : { kind: 'starter' as const, starterId: source.value as 'trajectory' | 'reusable-cues' };
      const input = JSON.stringify({ name, source: selectedSource });
      if (pendingCommand && pendingInput !== input) { feedback.value = 'The previous creation is still unconfirmed. Restore its input to retry, or reload and inspect the shot list before starting another.'; return; }
      pendingInput = input;
      pendingCommand ??= { protocolVersion: 'motion.project-protocol.v1', kind: 'motion.shot.admit',
        operationId: `admit_${crypto.randomUUID()}`, projectId: catalog.projectId, expectedCatalogRevision: catalog.catalogRevision,
        documentId: `shot_${crypto.randomUUID()}`, name, source: selectedSource, claim: null };
      const response = await options.client.admit(pendingCommand);
      if (!response.ok) {
        pendingCommand = null;
        feedback.value = `Shot was not created: ${response.diagnosticCode}. Your project is unchanged.`;
        if (response.inventory) feedback.value += ` ${response.inventory.supportedCount} supported, ${response.inventory.unsupportedCount} unsupported, ${response.inventory.missingCount} missing animations.`;
        if (response.code === 'STALE_CATALOG_REVISION') { catalog = await options.client.catalog(); render(); }
        return;
      }
      catalog = await options.client.catalog(); render();
      pendingCommand = null; entryDirty = false; admitting = false;
      feedback.value = 'Shot created. Choose it from Current shot when you are ready.';
      switchTo(response.documentId);
    } catch { feedback.value = 'Could not confirm creation. Retry with the same input to check that exact creation, or reload the shot list. Your input remains here.'; }
    finally { admitting = false; controls.forEach(control => { control.disabled = false; }); }
  });
  window.addEventListener('beforeunload', event => {
    if (!leaving && (options.pending() || admitting || options.dirty() || entryDirty)) { event.preventDefault(); }
  });
  render();
}
