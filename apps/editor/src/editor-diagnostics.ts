/** Test-only causal events. Never include operation payloads, IDs, or diagnostic messages. */
export function recordEditorDiagnostic(
  phase: 'handler' | 'enqueue' | 'start' | 'result', kind: string, expectedRevision: number,
  accepted: boolean | null = null,
  outcome: 'unknown' | 'applied' | 'stale' | 'publication-pending' | 'publication-failed' | 'rejected' = 'unknown',
): void {
  if (!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV
    || !(window as Window & { __motionDiagnostics?: boolean }).__motionDiagnostics) return;
  const action = kind === 'motion.history.undo' ? 'undo' : kind === 'motion.history.redo' ? 'redo' : 'other';
  document.dispatchEvent(new CustomEvent('motion:diagnostic', { detail: { phase, action, expectedRevision, accepted, outcome } }));
}
