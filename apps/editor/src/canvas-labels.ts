/** Place the selected moment's readable label inside the stage, away from its handle. */
export function placeCanvasLabels(handles: HTMLButtonElement[]): void {
  if (!document.querySelector('.normal-editor')) return;
  const canvas = document.querySelector<HTMLElement>('.preview-canvas')!;
  const stage = document.querySelector<HTMLElement>('.preview-stage')!.getBoundingClientRect();
  const rect = canvas.getBoundingClientRect(); const scale = rect.width / canvas.offsetWidth;
  for (const handle of handles) {
    const label = handle.querySelector<HTMLElement>('.trajectory-waypoint-label')!;
    const bounds = handle.getBoundingClientRect();
    label.style.translate = '';
    const width = label.offsetWidth * scale; const height = label.offsetHeight * scale;
    const left = Math.max(stage.left + 6, Math.min(bounds.right + 26, stage.right - width - 6));
    const top = Math.max(stage.top + 6, Math.min(bounds.bottom + 26, stage.bottom - height - 6));
    const sourceLeft = (left - rect.left) / scale - handle.offsetLeft;
    const sourceTop = (top - rect.top) / scale - handle.offsetTop;
    label.style.left = `${sourceLeft}px`; label.style.top = `${sourceTop}px`;
  }
}
