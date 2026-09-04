import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import {
  IDENTITY_DERIVATION_OPERATIONS, type ConstructRecord, type DiagnosticCode,
  type IdentityDerivationOperation, type OwnerAction, type OwnerBinding, type OwnerInput, sha256, stableJson,
} from './index.js';
import type { AnimationRecord, Inventory, LockedStylesheet, Prepared } from './acquisition-model.js';
import { IdentityBindFailureTracker, snapshotRuntimeActivity, trackIdentityBindOperation } from './runtime-trackers.js';
import { animationRecords, coded, installInstrumentation, readInstrumentation } from './runtime-capture.js';
import {
  HTML_NAMESPACE, REGISTERED_ELEMENT_ATTRIBUTES, REGISTERED_GLOBAL_ATTRIBUTES, REGISTERED_HTML_ELEMENTS,
  canonicalApplication, canonicalCssAst, canonicalCssValue, constructId, expandAnimationShorthand,
  normalizeCssTokenText, normalizeSelector,
} from './acquisition.js';

export type Runtime = { context: BrowserContext; page: Page; requests: string[]; errors: string[] };
export async function openLockedPage(browser: Browser, input: OwnerInput, profile: 'normal' | 'reduced'): Promise<Runtime> {
  const context = await newContext(browser, input, profile);
  const page = await context.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  const responseMap = new Map(input.sourceLock.responses.map((response) => [response.requestUrl, response]));
  const redirectMap = new Map(input.sourceLock.redirects.map((redirect) => [redirect.from, redirect]));
  let routeViolation = false;
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console-error'); });
  await page.route('**/*', async (route: Route) => {
    const url = route.request().url();
    const redirect = redirectMap.get(url);
    if (redirect) { await route.fulfill({ status: redirect.status, headers: { location: redirect.to }, body: '' }); return; }
    const response = responseMap.get(url);
    if (!response) { routeViolation = true; errors.push('route-violation'); await route.abort('blockedbyclient'); return; }
    await route.fulfill({ status: response.status, headers: { ...response.headers, 'content-type': response.mimeType }, body: response.body });
  });
  try {
    await page.goto(input.sourceLock.entryRequest, { waitUntil: 'load' });
    if (routeViolation) throw coded('PREPROCESSOR_ROUTE_VIOLATION');
    return { context, page, requests, errors };
  } catch (error) { await context.close(); throw error; }
}
export async function newContext(browser: Browser, input: OwnerInput, profile: 'normal' | 'reduced'): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: input.environment.viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
    colorScheme: 'light', contrast: 'no-preference', reducedMotion: profile === 'reduced' ? 'reduce' : 'no-preference',
    serviceWorkers: 'block', javaScriptEnabled: true,
  });
  await context.addInitScript(() => {
    const counts = { timeouts: 0, intervals: 0, observers: 0, workers: 0, storage: 0, fetches: 0, xhrs: 0, animations: 0, listeners: 0 };
    (window as unknown as { __motionBootstrap: typeof counts }).__motionBootstrap = counts;
    const originalTimeout = window.setTimeout.bind(window); window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => { if (document.currentScript !== null) counts.timeouts += 1; return originalTimeout(...args); }) as typeof window.setTimeout;
    const originalInterval = window.setInterval.bind(window); window.setInterval = ((...args: Parameters<typeof window.setInterval>) => { if (document.currentScript !== null) counts.intervals += 1; return originalInterval(...args); }) as typeof window.setInterval;
    const OriginalObserver = window.MutationObserver; window.MutationObserver = class extends OriginalObserver { constructor(callback: MutationCallback) { if (document.currentScript !== null) counts.observers += 1; super(callback); } };
    const originalFetch = window.fetch.bind(window); window.fetch = ((...args: Parameters<typeof window.fetch>) => { if (document.currentScript !== null) counts.fetches += 1; return originalFetch(...args); }) as typeof window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method: string, url: string | URL, asyncFlag: boolean = true, username?: string | null, password?: string | null) { if (document.currentScript !== null) counts.xhrs += 1; return originalOpen.call(this, method, url, asyncFlag, username, password); };
    const originalAnimate = Element.prototype.animate; Element.prototype.animate = function(...args: Parameters<Element['animate']>) { if (document.currentScript !== null) counts.animations += 1; return originalAnimate.apply(this, args); };
    const originalAdd = EventTarget.prototype.addEventListener; EventTarget.prototype.addEventListener = function(...args: Parameters<EventTarget['addEventListener']>) { if (document.currentScript !== null) counts.listeners += 1; return originalAdd.apply(this, args); };
    const OriginalWorker = window.Worker; window.Worker = class extends OriginalWorker { constructor(...args: ConstructorParameters<typeof Worker>) { if (document.currentScript !== null) counts.workers += 1; super(...args); } };
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const getItem = storage.getItem.bind(storage); storage.getItem = (key: string) => { if (document.currentScript !== null) counts.storage += 1; return getItem(key); };
      const setItem = storage.setItem.bind(storage); storage.setItem = (key: string, value: string) => { if (document.currentScript !== null) counts.storage += 1; setItem(key, value); };
      const removeItem = storage.removeItem.bind(storage); storage.removeItem = (key: string) => { if (document.currentScript !== null) counts.storage += 1; removeItem(key); };
      const clear = storage.clear.bind(storage); storage.clear = () => { if (document.currentScript !== null) counts.storage += 1; clear(); };
    }
  });
  return context;
}

export async function readBootstrapInstrumentation(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...(window as unknown as { __motionBootstrap: Record<string, number> }).__motionBootstrap }));
}

export function validateOwnerInputSemantics(input: OwnerInput): DiagnosticCode[] {
  const codes: DiagnosticCode[] = [];
  const responses = input.sourceLock.responses;
  const urls = responses.map((item) => item.requestUrl);
  if (new Set(urls).size !== urls.length || responses.some((item) => sha256(item.body) !== item.bodySha256)) codes.push('PREPROCESSOR_LOCK_MISMATCH');
  const entry = responses.find((item) => item.requestUrl === input.sourceLock.entryRequest);
  if (!entry || entry.bodySha256 !== input.sourceLock.originalSha256 || entry.mimeType !== 'text/html') codes.push('PREPROCESSOR_RESOURCE_INVALID');
  const allowedHeaders = new Set(['content-language', 'content-type', 'cache-control']);
  if (responses.some((item) => {
    const url = new URL(item.requestUrl);
    return url.username !== '' || url.password !== '' || Object.keys(item.headers).some((name) => !allowedHeaders.has(name.toLowerCase()))
      || Object.keys(item.headers).some((name) => /authorization|cookie|credential/i.test(name));
  })) codes.push('PREPROCESSOR_RESOURCE_INVALID');
  const bindingIds = input.bindings.map((item) => item.bindingId);
  if (new Set(bindingIds).size !== bindingIds.length || [...input.procedure.start, ...input.procedure.actions].some((action) => !bindingIds.includes(action.bindingId))) codes.push('PREPROCESSOR_ACTION_INVALID');
  if (stableJson([...input.expectedInventory.animatedBindingIds].sort()) !== stableJson(input.expectedInventory.animatedBindingIds)
    || input.expectedInventory.animatedBindingIds.some((id) => !bindingIds.includes(id))) codes.push('PREPROCESSOR_INVENTORY_MISMATCH');
  // Admission is closed and registered. Unknown HTML/native behavior never gets
  // a chance to execute in Chromium, including declarative shadow roots,
  // templates, marquee, SVG/SMIL, and future autonomous elements.
  if (responses.some((response) => !['text/html', 'text/css'].includes(response.mimeType))) codes.push('PREPROCESSOR_RESOURCE_INVALID');
  if (responses.some((response) => response.mimeType === 'text/html' && !isRegisteredHtml(response.body))) codes.push('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
  if (responses.some((response) => response.mimeType === 'text/css' && !isRegisteredCss(response.body))) codes.push('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
  return [...new Set(codes)];
}

export function isRegisteredHtml(html: string): boolean {
  let admitted = true;
  let doctypeCount = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || !admitted) return;
    const record = node as { nodeName?: string; name?: string; publicId?: string; systemId?: string; tagName?: string; namespaceURI?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: Array<{ nodeName?: string; value?: string }>; content?: unknown };
    if (record.nodeName === '#documentType') {
      doctypeCount += 1;
      if (record.name?.toLowerCase() !== 'html' || record.publicId !== '' || record.systemId !== '') admitted = false;
      return;
    }
    const tagName = record.tagName?.toLowerCase();
    if (tagName) {
      if (record.namespaceURI !== HTML_NAMESPACE || !REGISTERED_HTML_ELEMENTS.has(tagName) || record.content) { admitted = false; return; }
      for (const attribute of record.attrs ?? []) {
        const name = attribute.name.toLowerCase();
        const registered = REGISTERED_GLOBAL_ATTRIBUTES.has(name) || name.startsWith('aria-') || name.startsWith('data-')
          || REGISTERED_ELEMENT_ATTRIBUTES[tagName]?.has(name) === true;
        if (!registered || name === 'shadowrootmode' || name.startsWith('on')) { admitted = false; return; }
        if (name === 'style' && !isRegisteredCss(`x{${attribute.value}}`)) { admitted = false; return; }
      }
      if (tagName === 'meta' && !record.attrs?.some((attribute) => attribute.name.toLowerCase() === 'charset')) { admitted = false; return; }
      if (tagName === 'link') {
        const attrs = new Map((record.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value.toLowerCase()]));
        if (attrs.get('rel') !== 'stylesheet' || !attrs.has('href')) { admitted = false; return; }
      }
      if (tagName === 'input') {
        const type = record.attrs?.find((attribute) => attribute.name.toLowerCase() === 'type')?.value.toLowerCase() ?? 'text';
        if (!['text', 'checkbox'].includes(type)) { admitted = false; return; }
      }
      if (tagName === 'style') {
        const css = (record.childNodes ?? []).filter((child) => child.nodeName === '#text').map((child) => child.value ?? '').join('');
        if (!isRegisteredCss(css)) { admitted = false; return; }
      }
    }
    for (const child of record.childNodes ?? []) visit(child);
  };
  const parseErrors: string[] = [];
  try {
    const document = parse(html, { onParseError: (error) => parseErrors.push(error.code) });
    // parse5 intentionally repairs malformed HTML. Admission must reject the
    // original response before inspecting that repaired tree.
    if (parseErrors.length > 0) return false;
    visit(document);
  } catch { return false; }
  return admitted && doctypeCount === 1;
}

export function isRegisteredCss(css: string): boolean {
  let root: postcss.Root;
  try { root = postcss.parse(css); } catch { return false; }
  let admitted = true;
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'keyframes' || name === '-webkit-keyframes') return;
    if (name === 'media' && /^\(prefers-reduced-motion:\s*reduce\)$/i.test(rule.params.trim())) return;
    admitted = false;
  });
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) admitted = false;
    valueParser(declaration.value).walk((node) => {
      if (node.type === 'function' && ['url', 'image-set', '-webkit-image-set', 'local', 'paint'].includes(node.value.toLowerCase())) admitted = false;
    });
  });
  return admitted;
}

export async function ready(page: Page): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
export async function bindSource(page: Page, bindings: readonly OwnerBinding[], captureNamespaceSha256: string, tracker?: IdentityBindFailureTracker): Promise<Prepared['provenance']> {
  const identityTracker = tracker ?? new IdentityBindFailureTracker(1, bindings.length);
  try { await trackIdentityBindOperation(identityTracker, 'derive-node-identities', () => page.evaluate(async (captureNamespace) => {
    const scope = globalThis as typeof globalThis & { __motionIdentityDerivation?: { operation: IdentityDerivationOperation; evaluationEntered: boolean; enumerationComplete: boolean } };
    const progress = { operation: 'encoder-initialize' as IdentityDerivationOperation, evaluationEntered: true, enumerationComplete: false };
    scope.__motionIdentityDerivation = progress;
    const encode = new TextEncoder();
    progress.operation = 'element-enumeration';
    const elements = [...document.querySelectorAll('*')];
    progress.enumerationComplete = true;
    for (const element of elements) {
      const path: Array<{ namespace: string | null; tag: string; sameTagOrdinal: number; childSignature: string[] }> = [];
      let current: Element | null = element;
      while (current) {
        progress.operation = 'sibling-selection';
        const siblings = current.parentElement ? [...current.parentElement.children].filter((candidate) => candidate.namespaceURI === current!.namespaceURI && candidate.tagName === current!.tagName) : [current];
        progress.operation = 'child-signature';
        const childSignature = [...current.children].map((child) => `${child.namespaceURI}:${child.tagName.toLowerCase()}`).sort();
        progress.operation = 'ancestor-record';
        path.unshift({ namespace: current.namespaceURI, tag: current.tagName.toLowerCase(), sameTagOrdinal: siblings.indexOf(current), childSignature });
        current = current.parentElement;
      }
      progress.operation = 'path-serialization';
      const serializedPath = JSON.stringify(path);
      progress.operation = 'provenance-digest';
      const nodeProvenanceSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(serializedPath)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      progress.operation = 'provenance-attribute-write';
      element.setAttribute('data-motion-provenance', nodeProvenanceSha256);
      progress.operation = 'stable-input-serialization';
      const stableInput = JSON.stringify({ captureNamespace, nodeProvenanceSha256 });
      progress.operation = 'stable-digest';
      const stableDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(stableInput)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      progress.operation = 'stable-attribute-write';
      element.setAttribute('data-motion-stable', `node_${stableDigest.slice(0, 24)}`);
    }
    delete scope.__motionIdentityDerivation;
  }, captureNamespaceSha256)); } catch {
    let failure: { operation: IdentityDerivationOperation; evaluationEntered: boolean; enumerationComplete: boolean } = { operation: 'evaluation-dispatch', evaluationEntered: false, enumerationComplete: false };
    try {
      const observed = await page.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __motionIdentityDerivation?: { operation?: unknown; evaluationEntered?: unknown; enumerationComplete?: unknown } };
        const value = scope.__motionIdentityDerivation;
        return value && typeof value.operation === 'string' && typeof value.evaluationEntered === 'boolean' && typeof value.enumerationComplete === 'boolean'
          ? { operation: value.operation, evaluationEntered: value.evaluationEntered, enumerationComplete: value.enumerationComplete }
          : null;
      });
      if (observed && IDENTITY_DERIVATION_OPERATIONS.includes(observed.operation as IdentityDerivationOperation)) failure = { operation: observed.operation as IdentityDerivationOperation, evaluationEntered: observed.evaluationEntered, enumerationComplete: observed.enumerationComplete };
    } catch {}
    identityTracker.recordDerivationFailure(failure.operation, failure.evaluationEntered, failure.enumerationComplete);
    throw coded('PREPROCESSOR_RUNTIME_ERROR');
  }
  identityTracker.completeDerivation();
  const records: Array<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }> = [];
  for (const binding of bindings) {
    let count: number;
    try { count = await trackIdentityBindOperation(identityTracker, 'locator-count', () => page.locator(binding.locator).count()); } catch { throw coded('PREPROCESSOR_BINDING_INVALID'); }
    if (count !== 1) throw coded('PREPROCESSOR_BINDING_INVALID');
    identityTracker.completeLocatorCheck();
    const [stableId, nodeProvenanceSha256] = await trackIdentityBindOperation(identityTracker, 'identity-read', () => Promise.all([page.locator(binding.locator).getAttribute('data-motion-stable'), page.locator(binding.locator).getAttribute('data-motion-provenance')]));
    if (!stableId || !nodeProvenanceSha256) throw coded('PREPROCESSOR_BINDING_INVALID');
    identityTracker.completeIdentityRead();
    await trackIdentityBindOperation(identityTracker, 'binding-marker-write', () => page.locator(binding.locator).evaluate((element, value) => {
      element.setAttribute('data-owner-binding', value.bindingId);
    }, { bindingId: binding.bindingId }));
    identityTracker.completeMarkerWrite();
    records.push({ bindingId: binding.bindingId, stableId, nodeProvenanceSha256, captureNamespaceSha256 });
  }
  const finalized = trackIdentityBindOperation(identityTracker, 'finalize-records', () => { if (new Set(records.map((item) => item.stableId)).size !== records.length) throw coded('PREPROCESSOR_BINDING_INVALID'); return records.sort((a, b) => a.bindingId.localeCompare(b.bindingId)); });
  identityTracker.completeFinalization();
  return finalized;
}
export async function verifyReplayBindings(page: Page, provenance: Prepared['provenance']): Promise<void> {
  for (const item of provenance) {
    const locator = page.locator(`[data-motion-stable="${item.stableId}"]`);
    if (await locator.count() !== 1 || await locator.getAttribute('data-motion-provenance') !== item.nodeProvenanceSha256) throw coded('PREPROCESSOR_BINDING_INVALID');
  }
}

export async function executeActions(page: Page, actions: readonly OwnerAction[], bindings: readonly OwnerBinding[], replay: boolean): Promise<void> {
  const byId = new Map(bindings.map((item) => [item.bindingId, item]));
  for (const action of actions) {
    const binding = byId.get(action.bindingId);
    if (!binding) throw coded('PREPROCESSOR_ACTION_INVALID');
    const locator = replay ? page.locator(`[data-motion-binding="${action.bindingId}"]`) : page.locator(binding.locator);
    if (await locator.count() !== 1) throw coded('PREPROCESSOR_ACTION_INVALID');
    if (action.kind === 'click') await locator.click();
    else if (action.kind === 'focus') await locator.focus();
    else if (action.kind === 'hover') await locator.hover();
    else if (action.kind === 'key' && action.key) await locator.press(action.key === 'Space' ? ' ' : action.key);
  }
}

export function lockedStylesheets(input: OwnerInput): readonly LockedStylesheet[] {
  const entry = input.sourceLock.responses.find((response) => response.requestUrl === input.sourceLock.entryRequest);
  if (!entry) throw coded('PREPROCESSOR_RESOURCE_INVALID');
  const redirects = new Map(input.sourceLock.redirects.map((redirect) => [redirect.from, redirect.to]));
  const responses = new Map(input.sourceLock.responses.map((response) => [response.requestUrl, response]));
  const externalHrefs = new Set<string>();
  const stylesheets: LockedStylesheet[] = [];
  const document = parse(entry.body, { sourceCodeLocationInfo: true });
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as {
      tagName?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: unknown[];
      sourceCodeLocation?: { startTag?: { endOffset: number }; endTag?: { startOffset: number } };
    };
    const tagName = record.tagName?.toLowerCase();
    if (tagName === 'style') {
      const start = record.sourceCodeLocation?.startTag?.endOffset;
      const end = record.sourceCodeLocation?.endTag?.startOffset;
      if (start === undefined || end === undefined || start > end) throw coded('PREPROCESSOR_RESOURCE_INVALID');
      stylesheets.push({ kind: 'inline', css: entry.body.slice(start, end) });
    } else if (tagName === 'link') {
      const attributes = new Map((record.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
      if (attributes.get('rel')?.toLowerCase() === 'stylesheet') {
        const rawHref = attributes.get('href');
        if (!rawHref) throw coded('PREPROCESSOR_RESOURCE_INVALID');
        const href = new URL(rawHref, input.sourceLock.entryRequest).href;
        if (externalHrefs.has(href)) throw coded('PREPROCESSOR_RESOURCE_INVALID');
        externalHrefs.add(href);
        let responseUrl = href;
        const visited = new Set<string>();
        while (redirects.has(responseUrl)) {
          if (visited.has(responseUrl)) throw coded('PREPROCESSOR_RESOURCE_INVALID');
          visited.add(responseUrl);
          responseUrl = redirects.get(responseUrl)!;
        }
        const response = responses.get(responseUrl);
        if (!response || response.mimeType !== 'text/css') throw coded('PREPROCESSOR_RESOURCE_INVALID');
        stylesheets.push({ kind: 'external', href, css: response.body });
      }
    }
    for (const child of record.childNodes ?? []) visit(child);
  };
  visit(document);
  return stylesheets;
}

export async function buildReplay(page: Page, locked: readonly LockedStylesheet[]): Promise<{ html: string; css: string }> {
  return page.evaluate((expected) => {
    const nodes = [...document.querySelectorAll('style,link[rel~="stylesheet"]')];
    const sheets = [...document.styleSheets];
    if (nodes.length !== expected.length || sheets.length !== expected.length) throw new Error('PREPROCESSOR_RESOURCE_INVALID');
    for (const [index, descriptor] of expected.entries()) {
      const node = nodes[index];
      const sheet = sheets[index];
      if (!node || !sheet || sheet.ownerNode !== node) throw new Error('PREPROCESSOR_RESOURCE_INVALID');
      if (descriptor.kind === 'inline') {
        if (!(node instanceof HTMLStyleElement) || sheet.href !== null) throw new Error('PREPROCESSOR_RESOURCE_INVALID');
      } else if (!(node instanceof HTMLLinkElement) || node.href !== descriptor.href || sheet.href !== descriptor.href) {
        throw new Error('PREPROCESSOR_RESOURCE_INVALID');
      }
      try { void sheet.cssRules.length; } catch { throw new Error('PREPROCESSOR_RESOURCE_INVALID'); }
    }
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script,style,link[rel="stylesheet"]').forEach((node) => node.remove());
    for (const element of [...clone.querySelectorAll<HTMLElement>('[data-motion-stable]')]) {
      const source = document.querySelector<HTMLElement>(`[data-motion-stable="${element.dataset.motionStable}"]`);
      if (!source) throw new Error('PREPROCESSOR_BINDING_INVALID');
      const binding = source.getAttribute('data-owner-binding');
      if (binding) element.setAttribute('data-motion-binding', binding);
      element.removeAttribute('data-owner-binding');
    }
    return { html: `<!doctype html>${clone.outerHTML}`, css: expected.map((descriptor) => descriptor.css).join('\n') };
  }, locked);
}

export async function inventoryPage(page: Page, bindings: readonly OwnerBinding[]): Promise<Inventory> {
  const animatedIds = new Set(bindings.filter((item) => item.role !== 'trigger').map((item) => item.bindingId));
  return page.evaluate((expectedAnimated) => {
    let cssRules = 0; let keyframes = 0; let applications = 0; let pseudos = 0; let conditionals = 0; let transitions = 0;
    for (const sheet of [...document.styleSheets]) {
      const pending = [...sheet.cssRules].reverse();
      while (pending.length > 0) {
        const rule = pending.pop()!;
        cssRules += 1;
        if (rule instanceof CSSKeyframesRule) keyframes += 1;
        if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) conditionals += 1;
        if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes('::')) pseudos += 1;
          const animationNames = rule.style.animationName.split(',').map((item) => item.trim()).filter((item) => item && item !== 'none');
          let matches = 0; try { matches = document.querySelectorAll(rule.selectorText).length; } catch { matches = 0; }
          applications += animationNames.length * matches;
          if (rule.style.transition && rule.style.transition !== 'none' && rule.style.transitionDuration !== '0s') transitions += matches;
        }
        if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) pending.push(...[...(rule as CSSGroupingRule).cssRules].reverse());
      }
    }
    return {
      dom: document.querySelectorAll('*').length, cssRules, keyframes, applications,
      scripts: document.scripts.length, resources: [...document.styleSheets].filter((sheet) => Boolean(sheet.href)).length,
      pseudos, conditionals, transitions, animatedBindingIds: [...expectedAnimated].sort(),
    };
  }, [...animatedIds]);
}

export async function deriveLedger(page: Page, input: OwnerInput, inventory: Inventory, requests: readonly string[], effects: { mutations: number; events: string[] }, animations: readonly AnimationRecord[]): Promise<ConstructRecord[]> {
  const raw = await page.evaluate(() => {
    const rows: Array<{ kind: ConstructRecord['kind']; basis: string; outputBasis: string; disposition: ConstructRecord['disposition']; cssPath?: number[] }> = [];
    document.querySelectorAll('*').forEach((element) => {
      const attrs = [...element.attributes]
        .filter((attribute) => !['data-motion-stable', 'data-motion-provenance', 'data-owner-binding'].includes(attribute.name.toLowerCase()))
        .map((attribute) => ({ name: attribute.name, value: attribute.value })).sort((a, b) => a.name.localeCompare(b.name));
      const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('');
      const basis = JSON.stringify({ namespace: element.namespaceURI ?? '', tag: element.tagName.toLowerCase(), stableId: element.getAttribute('data-motion-stable') ?? '', attrs, directText });
      const inlined = ['link', 'style'].includes(element.tagName.toLowerCase());
      rows.push({ kind: 'dom', basis, outputBasis: `${inlined ? 'removed-after-inline' : 'preserved'}:${basis}`, disposition: inlined ? 'inlined-locked' : 'preserved-declarative' });
    });
    let rootRuleIndex = 0;
    for (const sheet of [...document.styleSheets]) {
      const pending = [...sheet.cssRules].map((rule, localIndex) => ({ rule, parentPath: [] as number[], localIndex })).reverse();
      while (pending.length > 0) {
        const { rule, parentPath, localIndex } = pending.pop()!;
        const cssPath = parentPath.length === 0 ? [rootRuleIndex++] : [...parentPath, localIndex];
        const cssDigestBasis = rule.cssText;
        if (rule instanceof CSSKeyframesRule) rows.push({ kind: 'keyframe', basis: cssDigestBasis, outputBasis: `preserved:${cssDigestBasis}`, disposition: 'preserved-declarative', cssPath });
        else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) rows.push({ kind: 'conditional', basis: cssDigestBasis, outputBasis: `condition-preserved:${cssDigestBasis}`, disposition: rule instanceof CSSMediaRule && /^\(prefers-reduced-motion:\s*reduce\)$/i.test(rule.conditionText) ? 'condition-preserved' : 'unsupported', cssPath });
        else rows.push({ kind: 'css-rule', basis: cssDigestBasis, outputBasis: `preserved:${cssDigestBasis}`, disposition: 'preserved-declarative', cssPath });
        if (rule instanceof CSSStyleRule) {
          let matched: Element[] = []; try { matched = [...document.querySelectorAll(rule.selectorText)]; } catch { matched = []; }
          const names = rule.style.animationName.split(',').map((item) => item.trim()).filter((item) => item && item !== 'none');
          if (rule.selectorText.includes('::')) rows.push({ kind: 'pseudo', basis: cssDigestBasis, outputBasis: `preserved:${cssDigestBasis}`, disposition: /animation/i.test(rule.style.cssText) ? 'unsupported' : 'preserved-declarative' });
          if (rule.style.transition && rule.style.transition !== 'none' && rule.style.transitionDuration !== '0s') rows.push({ kind: 'transition', basis: cssDigestBasis, outputBasis: `unsupported:${cssDigestBasis}`, disposition: 'unsupported' });
        }
        if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) pending.push(...[...(rule as CSSGroupingRule).cssRules].map((child, childIndex) => ({ rule: child, parentPath: cssPath, localIndex: childIndex })).reverse());
      }
    }
    // Defensive only: preflight rejects scripts before this browser path is reachable.
    document.querySelectorAll('script').forEach((script) => { const basis = script.textContent ?? ''; rows.push({ kind: 'script', basis, outputBasis: `unsupported:${basis}`, disposition: 'unsupported' }); });
    return rows;
  });
  const rows = raw.map((item) => {
    if (!item.cssPath) return item;
    let node: postcss.ChildNode;
    try { node = postcss.parse(item.basis).nodes[0]!; } catch { throw coded('PREPROCESSOR_ARTIFACT_INVALID'); }
    if (!node || (node.type !== 'rule' && node.type !== 'atrule')) throw coded('PREPROCESSOR_ARTIFACT_INVALID');
    return { ...item, basis: stableJson({ path: item.cssPath, ast: canonicalCssAst(node, item.kind === 'conditional') }) };
  });
  animations.forEach((animation) => { const basis = canonicalApplication(animation); rows.push({ kind: 'application', basis, outputBasis: `preserved:${basis}`, disposition: 'preserved-declarative' }); });
  input.sourceLock.responses.forEach((response) => { const basis = stableJson({ digest: response.bodySha256, mime: response.mimeType, status: response.status }); rows.push({ kind: 'resource', basis, outputBasis: stableJson({ disposition: response.mimeType === 'text/html' ? 'replay-document' : 'inlined-body', bodySha256: response.bodySha256 }), disposition: response.mimeType === 'text/html' ? 'preserved-declarative' : 'inlined-locked' }); });
  input.sourceLock.redirects.forEach((redirect) => { const basis = stableJson({ from: sha256(redirect.from), to: sha256(redirect.to), status: redirect.status }); rows.push({ kind: 'resource', basis, outputBasis: `resolved:${basis}`, disposition: 'inlined-locked' }); });
  input.bindings.forEach((binding) => rows.push({ kind: 'event', basis: binding.bindingId, outputBasis: `stable-identity:${binding.bindingId}`, disposition: 'identity-bound' }));
  [...input.procedure.start, ...input.procedure.actions].forEach((action, index) => { const basis = `${action.bindingId}:${action.kind}:${index}`; rows.push({ kind: 'action', basis, outputBasis: `executed:${basis}`, disposition: 'owner-action-executed' }); });
  rows.push({ kind: 'reset', basis: input.procedure.reset, outputBasis: `proved:${input.procedure.reset}`, disposition: 'reset-proved' });
  if (effects.mutations > 0) rows.push({ kind: 'mutation', basis: String(effects.mutations), outputBasis: `unsupported:${effects.mutations}`, disposition: 'unsupported' });
  effects.events.forEach((event, index) => { const basis = `${event}:${index}`; rows.push({ kind: 'event', basis, outputBasis: `executed:${basis}`, disposition: 'owner-action-executed' }); });
  if (inventory.pseudos > 0 && !rows.some((item) => item.kind === 'pseudo')) rows.push({ kind: 'pseudo', basis: 'pseudo-unaccounted', outputBasis: 'unsupported:pseudo-unaccounted', disposition: 'unsupported' });
  const records = rows.map((item) => ({ id: constructId(item.kind, item.basis), kind: item.kind, disposition: item.disposition, canonicalInput: item.basis, canonicalOutput: item.outputBasis }));
  if (new Set(records.map((record) => record.id)).size !== records.length) throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

export function assertLedgerBijection(ledger: readonly ConstructRecord[], input: OwnerInput, inventory: Inventory, replayHtml: string): void {
  const count = (kind: ConstructRecord['kind']): number => ledger.filter((record) => record.kind === kind).length;
  const cssConstructs = count('css-rule') + count('keyframe') + count('conditional');
  if (count('dom') !== inventory.dom || cssConstructs !== inventory.cssRules
    || count('application') !== inventory.applications
    || count('resource') !== input.sourceLock.responses.length + input.sourceLock.redirects.length
    || count('action') !== input.procedure.start.length + input.procedure.actions.length
    || count('reset') !== 1 || ledger.some((record) => record.disposition === 'unsupported')) {
    throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
  }

  const entry = input.sourceLock.responses.find((response) => response.requestUrl === input.sourceLock.entryRequest)!;
  const expectedReplayNodes = countHtmlElements(entry.body, (tagName) => !['link', 'style'].includes(tagName));
  const replayBoundNodes = countHtmlElements(replayHtml, (_tagName, attrs) => attrs.some((attribute) => attribute.name.toLowerCase() === 'data-motion-stable'));
  if (expectedReplayNodes !== replayBoundNodes) throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
}

export function countHtmlElements(html: string, include: (tagName: string, attrs: readonly { name: string; value: string }[]) => boolean): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] };
    if (record.tagName && include(record.tagName.toLowerCase(), record.attrs ?? [])) count += 1;
    for (const child of record.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return count;
}

export function assertLockedRequestClosure(input: OwnerInput, requests: readonly string[], errors: readonly string[]): void {
  if (errors.includes('route-violation')) throw coded('PREPROCESSOR_ROUTE_VIOLATION');
  const expected = [...input.sourceLock.responses.map((response) => response.requestUrl), ...input.sourceLock.redirects.map((redirect) => redirect.from)].sort();
  const actual = [...requests].sort();
  if (stableJson(actual) !== stableJson(expected)) throw coded('PREPROCESSOR_RESOURCE_INVALID');
}
