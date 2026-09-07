/** Display seconds without rounding away an exact millisecond value. */
export function displayTime(milliseconds: number): string {
  return document.querySelector('.normal-editor') ? `${milliseconds / 1000} s` : `${milliseconds} ms`;
}

/** Normal projects play every compiled animation, even after the editable path ends. */
export function previewTransportEnd(durationMs: number, settledMs?: number): number {
  return document.querySelector('.normal-editor') || settledMs === undefined ? durationMs : settledMs + 1;
}
