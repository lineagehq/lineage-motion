import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Browser, TestInfo } from '@playwright/test';
import { bundleSchema, type DiagnosticEvent } from './diagnostic-schema.ts';

export async function writeDiagnosticBundle(info: TestInfo, browser: Browser, events: DiagnosticEvent[]) {
  const root = resolve(import.meta.dirname, '../../..');
  const primitive = (value: unknown) => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
  const matcher = (info.error as { matcherResult?: { name?: string; expected?: unknown; actual?: unknown } } | undefined)?.matcherResult;
  const message = (info.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '');
  const numeric = (label: string) => {
    const text = message.match(new RegExp(`${label}:\\s*(-?[0-9]+(?:\\.[0-9]+)?|true|false)(?:\\s|$)`))?.[1];
    return text === 'true' ? true : text === 'false' ? false : text === undefined ? null : primitive(Number(text));
  };
  const source = relative(root, info.file);
  const frame = (info.error?.stack ?? '').split('\n').find(line => line.includes(`${info.file}:`));
  const assertionLine = frame?.match(/:(\d+):\d+\)?$/)?.[1];
  const knownMatcher = matcher?.name ?? message.match(/\.(toBe|toEqual|toHaveText|toBeVisible|toBeEnabled)\(/)?.[1];
  const data = bundleSchema.parse({ version: 1, run: process.env.MOTION_DIAGNOSTIC_RUN,
    suite: process.env.MOTION_DIAGNOSTIC_SUITE ?? 'direct',
    ciRun: process.env.GITHUB_RUN_ID ?? null, ciAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    droppedEvents: (events as DiagnosticEvent[] & { dropped?: number }).dropped ?? 0,
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    test: createHash('sha256').update(info.titlePath.join('\n')).digest('hex'),
    source, line: assertionLine ? Number(assertionLine) : info.line, attempt: info.retry,
    browser: info.project.use.browserName ?? 'chromium', viewport: info.project.use.viewport,
    assertion: { matcher: ['toBe', 'toEqual', 'toHaveText', 'toBeVisible', 'toBeEnabled'].includes(knownMatcher ?? '') ? knownMatcher : 'other',
      expected: primitive(matcher?.expected) ?? numeric('Expected'), actual: primitive(matcher?.actual) ?? numeric('Received') },
    screenshot: 'Rendered diagnostic state; no editor pixels', events });
  const path = info.outputPath('safe-candidate');
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, 'diagnostic.json'), JSON.stringify(data), { mode: 0o600 });
  // Never screenshot the editor: authored CSS, media, DOM, URLs and capabilities are unbounded.
  // A separate context renders only validated diagnostic data. Staging regenerates these pixels.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<h1>Failure diagnostic state</h1><p>Rendered diagnostic state; no editor pixels</p><pre></pre>');
    await page.locator('pre').evaluate((element, text) => { element.textContent = text; }, JSON.stringify(data, null, 2));
    await page.screenshot({ path: info.outputPath('diagnostic-state.local.png') });
  } finally { await context.close(); }
}
