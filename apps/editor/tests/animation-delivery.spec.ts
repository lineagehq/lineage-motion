import { expect, test } from './test-fixture.ts';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { Actions, environment, fixtures, uiShot, cliShot, uiSequence, cliSequence, visibleShotMotion } from './animation-delivery-helpers.ts';
const variants = [{ name: 'UI-only', kind: 'ui', width: 1280, height: 720 }, { name: 'CLI-only authoring', kind: 'cli', width: 1440, height: 900 },
    { name: 'Mixed desktop', kind: 'mixed', width: 1280, height: 720 }, { name: 'Mixed large desktop', kind: 'mixed', width: 1440, height: 900 },
    { name: 'Mixed keyboard mobile', kind: 'mixed', width: 390, height: 844, keyboard: true }];
for (const variant of variants)
    test(`animation delivery: ${variant.name}`, async ({ page, context, browser }) => {
        test.setTimeout(600000);
        const started = Date.now();
        const env = await environment();
        const a = new Actions(page, env.directory, variant.keyboard ?? false, started);
        const sourceDigests = await Promise.all(fixtures.map(async (file) => createHash('sha256').update(await readFile(file)).digest('hex')));
        try {
            await page.setViewportSize({ width: variant.width, height: variant.height });
            await a.navigate(env.app.editorUrl);
            if (variant.kind !== 'ui') {
                const help = await a.cli('help');
                expect(help.sequences).toContain('sequence-clip-hold');
                await cliShot(a, 0);
                await a.navigate(env.app.editorUrl);
                await a.select(page.locator('[data-project-shot]'), 'Opening');
                await expect.poll(() => page.locator('[data-action-target] option').allTextContents()).toEqual(expect.arrayContaining(['Moving tile', 'Caption']));
                await a.click(page.getByRole('button', { name: 'Play', exact: true }));
                a.motionProofs.push(await visibleShotMotion(page));
                await a.click(page.getByRole('button', { name: 'Pause', exact: true }));
                a.firstMotionMs = Date.now() - a.started;
            }
            else
                await uiShot(a, 0);
            expect(a.firstMotionMs).toBeLessThanOrEqual(120000);
            if (variant.kind === 'cli') {
                await cliShot(a, 1);
                await cliSequence(a);
                await a.navigate(env.app.editorUrl);
                await a.select(page.getByRole('combobox', { name: 'Current animation', exact: true }), 'Delivery animation');
                await a.settled(5);
            }
            else {
                await uiShot(a, 1);
                await uiSequence(a);
            }
            await expect(page.locator('[data-sequence-summary]')).toContainText('2 shots · 5.5 s');
            await expect(page.locator('[data-clip-select]')).toHaveText(['Ending', 'Opening']);
            if (variant.kind !== 'cli') {
                await a.fill(page.getByLabel('End hold (seconds)'), '-1');
                await a.click(page.getByRole('button', { name: 'Apply end hold', exact: true }));
                await expect(page.getByLabel('End hold (seconds)')).toHaveValue('-1');
                await expect(page.getByLabel('End hold (seconds)')).toBeFocused();
                await a.settled(5);
                await a.click(page.getByRole('button', { name: 'Discard storyboard draft', exact: true }));
            }
            if (variant.kind === 'mixed') {
                const before = await a.cli('sequence');
                const id = before.sequence.sequenceId, common = ['--sequence-id', id, '--claim', 'handoff'];
                await a.cli('sequence-claim-acquire', [...common, '--expected-revision', '5', '--operation-id', 'handoff-acquire']);
                await a.cli('sequence-rename', [...common, '--expected-revision', '5', '--operation-id', 'handoff-rename', '--name', 'Agent refined delivery']);
                const saved = await a.cli('sequence');
                await a.cli('sequence-rename', [...common, '--expected-revision', '5', '--operation-id', 'stale-name', '--name', 'Rejected stale name'], 3);
                expect((await a.cli('sequence')).canonicalDigest).toBe(saved.canonicalDigest);
                await a.cli('sequence-claim-release', [...common, '--expected-revision', '6', '--lease-version', '1', '--operation-id', 'handoff-release']);
                await a.settled(6);
                await expect(page.locator('[data-sequence-summary]')).toContainText('Agent refined delivery');
                await a.fill(page.getByLabel('Animation name draft'), 'Delivery animation');
                await a.click(page.getByRole('button', { name: 'Rename animation', exact: true }));
                await a.settled(7);
                if (variant.name === 'Mixed desktop') {
                    await a.fill(page.getByLabel('End hold (seconds)'), '0.5');
                    const requestIds: string[] = [];
                    let disconnected!: () => void;
                    const offlineReady = new Promise<void>(resolve => { disconnected = resolve; });
                    await page.route('**/api/sequence/v1/commands', async route => {
                        requestIds.push(route.request().postDataJSON().operationId);
                        if (requestIds.length === 1) { await route.abort('internetdisconnected'); await context.setOffline(true); disconnected(); }
                        else await route.continue();
                    });
                    await a.click(page.getByRole('button', { name: 'Apply end hold', exact: true }));
                    await offlineReady;
                    await expect(page.getByRole('button', { name: 'Retry unconfirmed change' })).toBeVisible();
                    await expect(page.getByLabel('End hold (seconds)')).toHaveValue('0.5');
                    await expect(page.locator('[data-sequence-summary]')).toContainText('Saved revision 7');
                    await context.setOffline(false);
                    await a.click(page.getByRole('button', { name: 'Retry unconfirmed change' }));
                    await a.settled(8);
                    expect(requestIds).toHaveLength(2); expect(requestIds[0]).toBe(requestIds[1]);
                    await page.unroute('**/api/sequence/v1/commands');
                }
            }
            await a.click(page.getByRole('button', { name: 'Play all', exact: true }));
            await expect(page.locator('[data-sequence-time]')).not.toHaveText('0 s');
            await a.click(page.getByRole('button', { name: 'Pause all', exact: true }));
            if (a.keyboard) {
                await a.focus(page.getByRole('slider', { name: 'Full animation time', exact: true }));
                await a.key('End');
                await a.key('ArrowLeft');
                await a.key('Home');
            }
            let exportCount = 0;
            const bytes = async () => {
                if (variant.kind === 'cli') {
                    const snapshot = await a.cli('sequence');
                    const file = join(env.directory, `delivery-${++exportCount}.zip`);
                    await a.cli('sequence-export', ['--sequence-id', snapshot.sequence.sequenceId, '--expected-revision', String(snapshot.sequence.revision), '--output', file]);
                    return readFile(file);
                }
                const event = page.waitForEvent('download');
                await a.click(page.getByRole('button', { name: 'Download full animation', exact: true }));
                return readFile((await (await event).path())!);
            };
            const archive = await bytes(), files = unzipSync(archive), receipt = JSON.parse(Buffer.from(files['receipt.json']!).toString('utf8'));
            expect(receipt.durationMs).toBe(5500);
            if (variant.kind === 'ui') {
                const artifact = test.info().outputPath('completed-animation.zip');
                await writeFile(artifact, archive);
                await test.info().attach('completed-animation.zip', { path: artifact, contentType: 'application/zip' });
            }
            await page.screenshot({ path: test.info().outputPath('saved-animation.png') });
            await page.goto('about:blank');
            await env.restart();
            await a.navigate(env.app.editorUrl);
            await a.select(page.getByRole('combobox', { name: 'Current animation', exact: true }), 'Delivery animation');
            await a.settled(receipt.revision);
            expect(await bytes()).toEqual(archive);
            // These are independent physical expectations for Ending(3s)+hold(.5s), Opening(2s).
            // Instrumentation reads native CSS; no authoring command is issued through the console.
            const times = [0, 1500, 2999, 3000, 3001, 3499, 3500, 3501, 4500, 5499, 5500, 5501];
            for (const time of times) {
                await page.locator('[data-sequence-scrub]').evaluate((input: HTMLInputElement, time) => { input.value = String(time); input.dispatchEvent(new Event('input', { bubbles: true })); }, time);
                const sample = await page.locator('[data-sequence-preview] iframe').evaluate((outer: HTMLIFrameElement) => {
                    const frame = [...outer.contentDocument!.querySelectorAll('iframe')].find(frame => frame.style.visibility === 'visible')!, doc = frame.contentDocument!, view = frame.contentWindow!;
                    return { color: view.getComputedStyle(doc.body).backgroundColor, x: new DOMMatrix(view.getComputedStyle(doc.querySelector('.actor')!).transform).m41, opacity: Number(view.getComputedStyle(doc.querySelector('p')!).opacity), paused: doc.getAnimations().every(a => a.playState === 'paused') };
                });
                const second = time >= 3500, duration = second ? 2000 : 3000, local = Math.min(duration, second ? time - 3500 : time);
                expect(sample).toMatchObject({ color: second ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)', paused: true });
                expect(sample.x).toBeCloseTo(120 * local / duration, 2);
                expect(sample.opacity).toBeCloseTo(local / duration, 4);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.goto('about:blank');
            await env.stop();
            for (const [name, data] of Object.entries(files))
                await writeFile(join(env.directory, name), data);
            const network: string[] = [];
            page.on('request', request => { if (/^https?:/.test(request.url()))
                network.push(request.url()); });
            await a.navigate(pathToFileURL(join(env.directory, 'animation.html')).href);
            await page.evaluate(() => (window as any).__motionSequence.ready);
            for (const reduced of ['no-preference', 'reduce'] as const) {
                await page.emulateMedia({ reducedMotion: reduced });
                for (const time of times) {
                    const sample = await page.evaluate(time => {
                        (window as any).__motionSequence.seek(time);
                        const frame = [...document.querySelectorAll('iframe')].find(frame => frame.style.visibility === 'visible')!, doc = frame.contentDocument!, view = frame.contentWindow!;
                        return { color: view.getComputedStyle(doc.body).backgroundColor, x: new DOMMatrix(view.getComputedStyle(doc.querySelector('.actor')!).transform).m41, opacity: Number(view.getComputedStyle(doc.querySelector('p')!).opacity) };
                    }, time);
                    const second = time >= 3500, duration = second ? 2000 : 3000, local = Math.min(duration, second ? time - 3500 : time);
                    expect(sample.color).toBe(second ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)');
                    expect(sample.x).toBeCloseTo(reduced === 'reduce' ? 40 : 120 * local / duration, 2);
                    if (reduced === 'no-preference')
                        expect(sample.opacity).toBeCloseTo(local / duration, 4);
                }
            }
            expect(network).toEqual([]);
            a.completeMs = Date.now() - a.started;
            expect(a.completeMs).toBeLessThanOrEqual(600000);
            const evidencePath = test.info().outputPath('delivery-evidence.json');
            await writeFile(evidencePath, JSON.stringify({ journey: variant.name, browser: browser.version(), node: process.version, inventories: a.inventories, motionProofs: a.motionProofs, keyboardOnlyUI: a.keyboard, firstVisibleAuthoredMotionMs: a.firstMotionMs, completeMs: a.completeMs, controlActions: a.controls, navigationActions: a.navigations, launcherStarts: 2, keyPresses: a.keys, cliCommands: a.commands, sourceDigests, canonicalDigest: receipt.canonicalDigest, exportDigest: receipt.exportDigest, revision: receipt.revision, sourceReceipts: receipt.sources, viewport: { width: variant.width, height: variant.height }, serviceStopped: true, independentCutSamples: times }, null, 2));
            await test.info().attach('delivery-evidence', { path: evidencePath, contentType: 'application/json' });
        }
        finally {
            await context.setOffline(false);
            await env.cleanup();
        }
    });
