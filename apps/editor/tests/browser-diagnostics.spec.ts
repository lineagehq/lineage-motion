import { test, expect } from './test-fixture.ts';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeDiagnostics } from './diagnostic-observer.ts';
import { bundleSchema } from './diagnostic-schema.ts';
import { stageBrowserDiagnostics } from '../../../scripts/stage-browser-diagnostics.ts';

const sentinel = 'PRIVATE_SENTINEL_9cbac68d';
const sample = () => ({ version: 1, run: '7dcecf4c-02a7-4601-b0bd-f1d18522933c', suite: 'browser',
  ciRun: process.env.GITHUB_RUN_ID ?? null, ciAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, droppedEvents: 0, dirty: false, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), test: 'b'.repeat(64), source: 'apps/editor/tests/browser-diagnostics.spec.ts', line: 1,
  attempt: 0, browser: 'chromium', viewport: { width: 1280, height: 900 },
  assertion: { matcher: 'toBe', expected: 2, actual: 1 }, screenshot: 'Rendered diagnostic state; no editor pixels', events: [] });

test('diagnostics exclude arbitrary DOM, URLs, headers, bodies, logs and unknown fields', async ({ browser }) => {
  const page = await browser.newPage();
  const events = await observeDiagnostics(page);
  try {
    await page.route('http://diagnostic.test/**', route => route.fulfill({ contentType: 'text/html',
      headers: { 'x-private': sentinel }, body: `<button data-undo>${sentinel}</button><input value="${sentinel}"><script>console.log('${sentinel}');fetch('/${sentinel}',{method:'POST',headers:{'x-private':'${sentinel}'},body:'${sentinel}'})</script>` }));
    await page.goto(`http://diagnostic.test/${sentinel}?capability=${sentinel}`);
    await page.locator('[data-undo]').click();
    await expect.poll(() => events.some(event => event.kind === 'click' && event.control === 'undo')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(sentinel);
    expect(events.some(event => event.kind === 'response')).toBe(true);
    expect(bundleSchema.safeParse({ ...sample(), unknown: sentinel }).success).toBe(false);
    expect(bundleSchema.safeParse({ ...sample(), source: 'apps/editor/tests/private-customer.spec.ts' }).success).toBe(false);
    await page.locator('body').evaluate(body => { const frame = document.createElement('iframe'); frame.srcdoc = '<button data-undo>nested</button>'; body.append(frame); });
    await page.frameLocator('iframe').locator('button').click();
    expect(events.filter(event => event.kind === 'click')).toHaveLength(1);
    for (let i = 0; i < 250; i++) await page.evaluate(() => { document.querySelector('button')!.toggleAttribute('disabled'); });
    expect(events.some(event => event.kind === 'click' && event.control === 'undo')).toBe(true);
    expect(events.length).toBeLessThanOrEqual(200);
    expect(bundleSchema.safeParse({ ...sample(), source: ['', 'Users', sentinel, 'secret'].join('/') }).success).toBe(false);
  } finally { await page.close(); }
});

test('upload staging rejects unknown nested attachments and emits only a safe rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'motion-diagnostic-'));
  try {
    const source = join(root, 'source'); const candidate = join(source, 'safe-candidate'); const destination = join(root, 'upload');
    await mkdir(candidate, { recursive: true });
    await writeFile(join(candidate, 'diagnostic.json'), JSON.stringify(sample()));
    expect((await stageBrowserDiagnostics(source, destination)).rejected).toBe(false);
    const [bundle] = await readdir(destination);
    expect(await readdir(join(destination, bundle!))).toEqual(['diagnostic-state.png', 'diagnostic.json']);
    await writeFile(join(candidate, 'secret.txt'), sentinel);
    expect((await stageBrowserDiagnostics(source, destination)).rejected).toBe(true);
    expect(await readdir(destination)).toEqual(['rejected.json']);
    expect(await readFile(join(destination, 'rejected.json'), 'utf8')).not.toContain(sentinel);
    await rm(join(candidate, 'secret.txt'));
    await writeFile(join(candidate, 'diagnostic.json'), JSON.stringify({ ...sample(), events: [{ secret: sentinel }] }));
    expect((await stageBrowserDiagnostics(source, destination)).rejected).toBe(true);
    expect(await readdir(destination)).toEqual(['rejected.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
