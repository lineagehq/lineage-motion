import { execFileSync } from 'node:child_process';
import { lstat, readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { bundleSchema } from '../apps/editor/tests/diagnostic-schema.ts';

/** Deliberately ignores local attachments/traces. Only strict candidate JSON crosses this boundary. */
export async function stageBrowserDiagnostics(source: string, destination: string) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  let count = 0;
  let rejected = false;
  let reason: 'unsafe-candidate' | 'renderer-unavailable' | 'source-unavailable' | 'no-candidates' = 'unsafe-candidate';
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const walk = async (directory: string, depth = 0): Promise<void> => {
    if (depth > 7) throw new Error('depth');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) { rejected = true; continue; }
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      if (entry.name !== 'safe-candidate') { await walk(path, depth + 1); continue; }
      try {
        if (++count > 100) throw new Error('limit');
        const files = await readdir(path);
        if (files.length !== 1 || files[0] !== 'diagnostic.json') throw new Error('unknown attachment');
        const input = join(path, 'diagnostic.json');
        const stat = await lstat(input);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 150_000) throw new Error('unsafe file');
        const data = bundleSchema.parse(JSON.parse(await readFile(input, 'utf8')));
        if (process.env.GITHUB_RUN_ID && (data.ciRun !== process.env.GITHUB_RUN_ID
          || data.ciAttempt !== process.env.GITHUB_RUN_ATTEMPT || data.dirty || data.suite === 'direct'
          || data.commit !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())) throw new Error('provenance');
        const output = join(destination, `${data.run}-${data.suite}-${data.test}-${data.attempt}`);
        await mkdir(output); // Duplicate identities are unsafe rather than silently overwritten.
        await writeFile(join(output, 'diagnostic.json'), JSON.stringify(data, null, 2));
        const context = await browser!.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          await page.route('**/*', route => route.abort());
          await page.setContent('<h1>Failure diagnostic state</h1><p>Rendered diagnostic state; no editor pixels</p><pre style="font-size:12px;white-space:pre-wrap"></pre>');
          const summary = [
            `Commit ${data.commit} | ${data.suite} | attempt ${data.attempt} | dirty ${data.dirty}`,
            `${data.source}:${data.line} ${data.assertion.matcher} expected=${data.assertion.expected} actual=${data.assertion.actual}`,
            ...data.events.filter(event => ['pointerdown', 'pointerup', 'click', 'handler', 'enqueue', 'start', 'result', 'projection'].includes(event.kind)).slice(-12).map(event => `${event.ms}ms ${event.kind} ${event.control} rev=${event.revision} history=${event.undoCount}/${event.redoCount} publication=${event.publication} pending=${event.pendingRevision} accepted=${event.accepted} outcome=${event.outcome}`),
          ].join('\n\n');
          await page.locator('pre').evaluate((element, text) => { element.textContent = text; }, summary);
          await page.screenshot({ path: join(output, 'diagnostic-state.png') });
        } finally { await context.close(); }
      } catch { rejected = true; }
    }
  };
  try {
    try { browser = await chromium.launch(); } catch { reason = 'renderer-unavailable'; throw new Error('renderer'); }
    try { await walk(source); } catch { reason = 'source-unavailable'; throw new Error('source'); }
  } catch { rejected = true; }
  finally { await browser?.close().catch(() => { rejected = true; reason = 'renderer-unavailable'; }); }
  if (!rejected && count === 0) { rejected = true; reason = 'no-candidates'; }
  if (rejected) {
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'rejected.json'), JSON.stringify({ status: 'rejected', reason, message: 'No candidate uploaded' }));
  }
  return { rejected, count };
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const result = await stageBrowserDiagnostics(resolve('apps/editor/test-results'), resolve('artifacts/safe-browser-diagnostics'));
  if (result.rejected) process.exitCode = 1;
}
