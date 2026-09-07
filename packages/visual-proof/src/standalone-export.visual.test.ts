import { expect, test } from 'vitest';
import { chromium } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { importMotionHtml } from '../../css-import/src/index.ts';
import { sha256Hex } from '../../domain/src/index.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { ExportServiceClient } from '../../motion-protocol/src/export.ts';
import { writeExportArtifact } from '../../motion-cli/src/export-artifact.ts';

const source = `<!doctype html><html><head><style>
html,body{margin:0;width:200px;height:100px;background:white}
.box{width:30px;height:30px;background:blue;animation:move 1000ms steps(2,end) both}
@keyframes move{from{transform:translateX(0px)}to{transform:translateX(100px)}}
@media(prefers-reduced-motion:reduce){.box{animation:none;transform:translateX(0px)}}
</style></head><body><div class="box"></div></body></html>`;

test('extracted HTML plays independently after service shutdown and matches native source at discrete boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-standalone-public-'));
  let service: Awaited<ReturnType<typeof startLocalMotionService>> | undefined;
  const browser = await chromium.launch();
  try {
    const imported = importMotionHtml(source);
    expect(imported.inventory.unsupportedCount).toBe(0); expect(imported.inventory.missingCount).toBe(0);
    service = await startLocalMotionService({ databasePath: join(directory, 'project.sqlite'), seed: imported.document! });
    const bundle = await new ExportServiceClient(service.url, { actor: 'human', capability: 'human-editor' }).shot({
      schemaVersion: 'motion.export-request.v1', projectId: service.store.readProjectCatalog().projectId,
      documentId: imported.document!.documentId, branchId: 'main', expectedRevision: 0 });
    if (!bundle.ok) throw new Error('EXPORT_FAILED');
    const archive = join(directory, 'shot.zip'); await writeExportArtifact(archive, bundle);
    const files = unzipSync(await readFile(archive));
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes);
    await service.close(); service = undefined;
    const normalHashes: string[][] = [];
    const reducedHashes: string[][] = [];
    for (const reducedMotion of ['no-preference', 'reduce'] as const) for (let replay = 0; replay < 3; replay++) {
      const context = await browser.newContext({ viewport: { width: 200, height: 100 }, deviceScaleFactor: 1,
        reducedMotion, colorScheme: 'light', serviceWorkers: 'block' });
      const network: string[] = [];
      await context.route('**/*', async (route) => {
        if (/^https?:/.test(route.request().url())) { network.push('unexpected'); await route.abort(); }
        else await route.continue();
      });
      try {
        const baseline = await context.newPage(); await baseline.setContent(source);
        const exported = await context.newPage(); await exported.goto(pathToFileURL(join(directory, 'animation.html')).href);
        const hashes: string[] = [];
        for (const time of [0, 249, 499, 500, 501, 999, 1000]) {
          for (const page of [baseline, exported]) {
            const count = await page.evaluate((at) => {
              const animations = document.getAnimations();
              for (const animation of animations) { animation.pause(); animation.currentTime = at; }
              return { count: animations.length, native: animations.every((animation) => animation instanceof CSSAnimation) };
            }, time);
            expect(count).toEqual({ count: reducedMotion === 'reduce' ? 0 : 1, native: true });
          }
          const originalHash = sha256Hex(await baseline.screenshot({ animations: 'allow' }));
          const exportHash = sha256Hex(await exported.screenshot({ animations: 'allow' }));
          expect(exportHash).toBe(originalHash); hashes.push(exportHash);
        }
        expect(network).toEqual([]);
        (reducedMotion === 'reduce' ? reducedHashes : normalHashes).push(hashes);
      } finally { await context.close(); }
    }
    expect(normalHashes[1]).toEqual(normalHashes[0]); expect(normalHashes[2]).toEqual(normalHashes[0]);
    expect(reducedHashes[1]).toEqual(reducedHashes[0]); expect(reducedHashes[2]).toEqual(reducedHashes[0]);
    expect(new Set(normalHashes[0]).size).toBeGreaterThan(1);
    expect(new Set(reducedHashes[0]).size).toBe(1);
  } finally { await browser.close(); await service?.close(); await rm(directory, { recursive: true, force: true }); }
}, 60_000);

test.each(['<meta charset="iso-8859-1">', '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'])(
  'standalone UTF-8 files preserve Unicode text despite source encoding %s', async meta => {
    const unicode = source.replace('<head>', `<head>${meta}`)
      .replace('<style>', '<style>@charset "iso-8859-1";\n#caption::after{content:" · Crème";}\n')
      .replace('</body>', '<p id="caption">Café —</p></body>');
    const directory = await mkdtemp(join(tmpdir(), 'motion-export-encoding-'));
    let service: Awaited<ReturnType<typeof startLocalMotionService>> | undefined;
    const browser = await chromium.launch();
    try {
      const imported = importMotionHtml(unicode);
      expect(imported.inventory).toMatchObject({ unsupportedCount: 0, missingCount: 0 });
      service = await startLocalMotionService({ databasePath: join(directory, 'project.sqlite'), seed: imported.document! });
      const result = await new ExportServiceClient(service.url, { actor: 'human', capability: 'human-editor' }).shot({
        schemaVersion: 'motion.export-request.v1', projectId: service.store.readProjectCatalog().projectId,
        documentId: imported.document!.documentId, branchId: 'main', expectedRevision: 0 });
      if (!result.ok) throw new Error('EXPORT_FAILED');
      const path = join(directory, 'shot.zip'); await writeExportArtifact(path, result);
      const files = unzipSync(await readFile(path));
      for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes);
      // Exercise the separately delivered CSS as a real stylesheet byte stream too.
      await writeFile(join(directory, 'reuse.html'), result.files['animation.html'].replace(/<style>[\s\S]*?<\/style>/g,
        '<link rel="stylesheet" href="./animation.css">'));
      expect(sha256Hex(files['animation.html']!)).toBe(result.receipt.htmlDigest);
      expect(sha256Hex(files['animation.css']!)).toBe(result.receipt.cssDigest);
      await service.close(); service = undefined;
      for (const reducedMotion of ['no-preference', 'reduce'] as const) {
        const context = await browser.newContext({ viewport: { width: 200, height: 100 }, reducedMotion });
        try {
          const baseline = await context.newPage(); await baseline.setContent(unicode);
          for (const filename of ['animation.html', 'reuse.html']) {
            const page = await context.newPage(); await page.goto(pathToFileURL(join(directory, filename)).href);
            expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
            expect(await page.locator('#caption').textContent()).toBe('Café —');
            expect(await page.locator('#caption').evaluate(element => getComputedStyle(element, '::after').content)).toBe('" · Crème"');
            for (const current of [baseline, page]) await current.evaluate(() => {
              for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 500; }
            });
            expect(sha256Hex(await page.screenshot({ animations: 'allow' })))
              .toBe(sha256Hex(await baseline.screenshot({ animations: 'allow' })));
            await page.close();
          }
        } finally { await context.close(); }
      }
    } finally { await browser.close(); await service?.close(); await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
