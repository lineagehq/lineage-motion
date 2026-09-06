import { createExportArchive } from '../../../packages/motion-protocol/src/export-archive.ts';
import type { ExportRequest, ExportServiceClient } from '../../../packages/motion-protocol/src/export.ts';

export type ExportContext = Omit<ExportRequest, 'schemaVersion'> & { saved: boolean };
export function mountShotExport(root: HTMLElement, client: ExportServiceClient,
  context: () => ExportContext): { refresh(): void } {
  const section = document.createElement('section'); section.className = 'shot-export';
  section.setAttribute('aria-label', 'Download animation');
  section.innerHTML = '<button type="button" data-export-shot>Download animation</button>'
    + '<p>Includes standalone HTML, CSS, and a verification receipt. Review reduced motion before downloading.</p>'
    + '<output data-export-status role="status" aria-live="polite"></output>';
  root.append(section);
  const button = section.querySelector<HTMLButtonElement>('button')!;
  const status = section.querySelector<HTMLOutputElement>('output')!;
  let busy = false;
  const refresh = () => {
    button.disabled = busy || !context().saved;
    button.textContent = busy ? 'Preparing download…' : 'Download animation';
  };
  button.addEventListener('click', async () => {
    const selected = context();
    if (busy || !selected.saved) return;
    busy = true; status.value = 'Preparing the saved animation…'; refresh();
    try {
      const { saved: _saved, ...identity } = selected;
      const result = await client.shot({ schemaVersion: 'motion.export-request.v1', ...identity });
      const current = context();
      if (!current.saved || current.projectId !== selected.projectId || current.documentId !== selected.documentId
        || current.branchId !== selected.branchId || current.expectedRevision !== selected.expectedRevision) {
        status.value = 'The selected animation changed. Wait for it to save, then download again.'; return;
      }
      if (!result.ok) {
        status.value = result.code === 'EXPORT_STALE_REVISION'
          ? 'A newer edit is available. Refresh the animation before downloading.'
          : result.code === 'EXPORT_UNSUPPORTED' ? 'This shot contains unsupported animation features. Correct them before exporting.'
            : 'Could not export this shot. Check the selected project and try again.';
        return;
      }
      const url = URL.createObjectURL(new Blob([createExportArchive(result)], { type: 'application/zip' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `animation-r${selected.expectedRevision}.zip`; link.hidden = true;
      section.append(link); link.click(); link.remove();
      // Keep the blob alive long enough for the browser's download handoff.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status.value = 'Animation downloaded. Unzip it and open animation.html to play it independently.';
    } catch { status.value = 'Could not download the animation. Check that the local app is running and try again.'; }
    finally { busy = false; refresh(); }
  });
  refresh(); return { refresh };
}
