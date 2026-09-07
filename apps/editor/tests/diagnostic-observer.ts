import type { Page, Request } from '@playwright/test';
import { eventSchema, type DiagnosticEvent } from './diagnostic-schema.ts';

export async function observeDiagnostics(page: Page) {
  const events = Object.assign([] as DiagnosticEvent[], { dropped: 0 });
  const started = Date.now();
  const append = (value: unknown) => {
    const parsed = eventSchema.safeParse(value);
    if (parsed.success) {
      events.push(parsed.data);
      if (events.length > 200) {
        let disposable = events.findIndex(event => event.kind === 'mutation' || (['request', 'response', 'requestfailed'].includes(event.kind) && event.endpoint === 'other'));
        if (disposable < 0) disposable = events.findIndex(event => ['projection', 'feedback'].includes(event.kind));
        events.dropped += 1;
        events.splice(disposable < 0 ? 0 : disposable, 1);
      }
    }
  };
  await page.exposeBinding('__recordMotionDiagnostic', (source, value: unknown) => { if (source.frame === page.mainFrame()) append({ ...(value as object), ms: Date.now() - started }); });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const host = window as unknown as { __recordMotionDiagnostic: (value: unknown) => Promise<void> };
    (window as Window & { __motionDiagnostics?: boolean }).__motionDiagnostics = true;
    const start = performance.now();
    const classify = (target: Element | null) => target?.closest('[data-undo]') ? 'undo'
      : target?.closest('[data-redo]') ? 'redo' : target ? 'other' : 'none';
    const capture = (kind: string, target: Element | null = null, extra: { outcome?: string; accepted?: boolean | null; expectedRevision?: number; action?: string } = {}) => {
      const state = window.__motionEditor?.inspectAuthoring();
      void host.__recordMotionDiagnostic({ ms: Math.round(performance.now() - start), kind,
        outcome: extra.outcome ?? 'unknown', accepted: extra.accepted ?? null, expectedRevision: extra.expectedRevision ?? null,
        control: extra.action ?? classify(target), revision: state?.revision ?? null, undoCount: state?.undoCount ?? null,
        redoCount: state?.redoCount ?? null, pendingRevision: state?.pendingRevision ?? null,
        publication: state?.publicationState ?? 'unknown', focus: classify(document.activeElement),
        undoEnabled: document.querySelector<HTMLButtonElement>('[data-undo]')?.matches(':not([disabled]):not([aria-disabled="true"])') === true,
        redoEnabled: document.querySelector<HTMLButtonElement>('[data-redo]')?.matches(':not([disabled]):not([aria-disabled="true"])') === true,
        status: 0, requestId: null, endpoint: 'other' });
    };
    document.addEventListener('motion:diagnostic', event => {
      const detail = (event as CustomEvent).detail; capture(detail.phase, null, detail);
    });
    for (const kind of ['pointerdown', 'pointerup', 'click'] as const)
      document.addEventListener(kind, event => capture(kind, event.target instanceof Element ? event.target : null), true);
    document.addEventListener('motion:projection', () => capture('projection'));
    document.addEventListener('motion:feedback', () => capture('feedback'));
    new MutationObserver(() => capture('mutation')).observe(document, { subtree: true, attributes: true,
      attributeFilter: ['disabled', 'data-publication-state', 'data-operation-pending'] });
  });
  const requests = new WeakMap<Request, number>();
  let nextRequest = 0;
  const network = (kind: 'request' | 'response' | 'requestfailed', request: Request, status = 0) => {
    if (!requests.has(request)) requests.set(request, ++nextRequest);
    const path = new URL(request.url()).pathname;
    const endpoint = /\/commands$/.test(path) ? 'commands' : /\/workspace$/.test(path) ? 'workspace'
      : /\/revisions\//.test(path) ? 'revision' : /\/head$/.test(path) ? 'head'
      : /\/branches$/.test(path) ? 'branches' : /\/claims$/.test(path) ? 'claims'
      : /\/activity$/.test(path) ? 'activity' : /\/events$/.test(path) ? 'events' : 'other';
    append({ ms: Date.now() - started, kind, outcome: 'unknown', accepted: null, expectedRevision: null, control: 'none',
      revision: null, undoCount: null, redoCount: null, pendingRevision: null, publication: 'unknown',
      undoEnabled: false, redoEnabled: false, focus: 'none', status, endpoint, requestId: requests.get(request) });
  };
  page.on('request', request => network('request', request));
  page.on('response', response => network('response', response.request(), response.status()));
  page.on('requestfailed', request => network('requestfailed', request));
  return events;
}
