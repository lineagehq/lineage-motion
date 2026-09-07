import { authoring, prepareAndDispatchIntent } from './main.js';
import type { AuthoringCue, CueSemantic } from '../../../packages/domain/src/index.js';

export function renderActionHistory(host: HTMLElement, edit: (cue: AuthoringCue) => void, busy: boolean): void {
  host.replaceChildren(...authoring.value.document.cues.filter((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1').map(cue => {
    const row = document.createElement('article'); const title = document.createElement('strong'); title.textContent = cue.label;
    row.append(title);
    for (const label of ['Edit', 'Detach', 'Delete'] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = busy;
      button.addEventListener('click', async () => {
        if (label === 'Edit') { edit(cue); return; }
        button.disabled = true; row.dataset.operationPending = 'true';
        const response = await prepareAndDispatchIntent({ kind: label === 'Detach' ? 'motion.cue.detach' : 'motion.cue.delete', cueId: cue.id });
        delete row.dataset.operationPending;
        if (!response.ok) { button.disabled = false; row.append(document.createTextNode(`Action unchanged: ${response.code}.`)); }
      });
      row.append(button);
    }
    return row;
  }));
}

export function semanticBounds(semantic: CueSemantic): [number, number] {
  switch (semantic.kind) {
    case 'cursor-path': return [semantic.startMs, semantic.arriveMs];
    case 'reveal': case 'type': return [semantic.startMs, semantic.completeMs];
    case 'hold': return [semantic.enterMs, semantic.exitMs];
    case 'click': return [semantic.arriveMs, semantic.pulseEndMs];
    case 'select': return [semantic.approachMs, semantic.settleMs];
    case 'drag': return [semantic.approachMs, semantic.releaseMs];
  }
}

/** Keep the saved semantic's additional roles, geometry and intermediate timing when editing. */
export function retimeSemantic(semantic: CueSemantic, start: number, end: number): CueSemantic {
  const [oldStart, oldEnd] = semanticBounds(semantic);
  const time = (value: number) => Math.round(start + (value - oldStart) * (end - start) / (oldEnd - oldStart));
  const next = structuredClone(semantic);
  switch (next.kind) {
    case 'cursor-path': next.startMs = start; next.arriveMs = end; next.waypoints = next.waypoints.map(point => ({ ...point, timeMs: time(point.timeMs) })); break;
    case 'reveal': case 'type': next.startMs = start; next.completeMs = end; break;
    case 'hold': next.enterMs = start; next.exitMs = end; next.durationMs = end - start; break;
    case 'click': next.arriveMs = start; next.pressMs = time(next.pressMs); next.releaseMs = time(next.releaseMs); next.pulseEndMs = end; break;
    case 'select': next.approachMs = start; next.chooseMs = time(next.chooseMs); next.settleMs = end; break;
    case 'drag': next.approachMs = start; next.pressMs = time(next.pressMs); next.moveStartMs = time(next.moveStartMs);
      next.arriveMs = time(next.arriveMs); next.releaseMs = end; next.waypoints = next.waypoints.map(point => ({ ...point, timeMs: time(point.timeMs) })); break;
  }
  return next;
}
