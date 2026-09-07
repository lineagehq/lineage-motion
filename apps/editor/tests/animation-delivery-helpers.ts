import { expect, type Locator, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { invoke } from '../../../packages/motion-cli/src/managed-test-support.ts';
import { spawnTestServer, stopTestServer, waitForTestServer } from './test-server.ts';
export const root = resolve(import.meta.dirname, '../../..');
export const fixtures = ['animation-opening.html', 'animation-ending.html'].map(name => join(root, 'fixtures/public-synthetic', name));
export async function launch(directory: string) {
    const child = spawnTestServer(process.execPath, ['--import', 'tsx', join(root, 'apps/editor/scripts/dev-editor.mjs'), '--project', 'Animation delivery', '--data-dir', directory, '--port', '0'], { cwd: root });
    try {
        return { child, ...await waitForTestServer(child) };
    }
    catch (error) {
        await stopTestServer(child);
        throw error;
    }
}
export async function environment() {
    const directory = await mkdtemp(join(tmpdir(), 'motion-delivery-'));
    let app = await launch(directory);
    return { directory, get app() { return app; }, stop: () => stopTestServer(app.child), restart: async () => { await stopTestServer(app.child); app = await launch(directory); }, cleanup: async () => { await stopTestServer(app.child); await rm(directory, { recursive: true, force: true }); } };
}
export class Actions {
    inventories: Array<{
        shot: string;
        stage: string;
        inventory: unknown;
    }> = [];
    motionProofs: Awaited<ReturnType<typeof visibleShotMotion>>[] = [];
    controls = 0;
    keys = 0;
    commands = 0;
    reverseChecked = false;
    navigations = 0;
    firstMotionMs = 0;
    completeMs = 0;
    constructor(readonly page: Page, readonly directory: string, readonly keyboard = false, readonly started = Date.now()) { }
    async navigate(url: string) { this.navigations++; await this.page.goto(url); }
    async key(value: string) { this.keys++; await this.page.keyboard.press(value); }
    async focus(target: Locator) {
        await expect(target).toBeVisible();
        await expect(target).toBeEnabled();
        for (let i = 0; i < 160; i++) {
            if (await target.evaluate(el => el === document.activeElement)) {
                if (!this.reverseChecked) {
                    await this.key('Shift+Tab');
                    await this.key('Tab');
                    this.reverseChecked = true;
                    expect(await target.evaluate(el => el === document.activeElement)).toBe(true);
                }
                return;
            }
            await this.key('Tab');
        }
        throw new Error('KEYBOARD_TARGET_NOT_REACHABLE');
    }
    async click(target: Locator) { this.controls++; if (this.keyboard) {
        await this.focus(target);
        await this.key(await target.evaluate(el => el.tagName === 'BUTTON') ? 'Space' : 'Enter');
    }
    else
        await target.click(); }
    async fill(target: Locator, value: string) { this.controls++; if (this.keyboard) {
        await this.focus(target);
        await this.key('ControlOrMeta+A');
        this.keys += value.length;
        await this.page.keyboard.type(value);
    }
    else
        await target.fill(value); }
    async select(target: Locator, label: string) { this.controls++; if (this.keyboard) {
        await this.focus(target);
        const prefix = await target.evaluate((el, label) => { const labels = [...(el as HTMLSelectElement).options].filter(option => !option.disabled).map(option => option.label.toLowerCase()); for (let n = 1; n <= label.length; n++)
            if (labels.filter(value => value.startsWith(label.slice(0, n).toLowerCase())).length === 1)
                return label.slice(0, n); return label; }, label);
        this.keys += prefix.length;
        await this.page.keyboard.type(prefix);
        await this.key('Tab');
    }
    else
        await target.selectOption({ label }); await expect(target.locator('option:checked')).toHaveText(label); }
    async cli(name: string, args: string[] = [], code = 0) { this.commands++; const result = await invoke([name, ...(name === 'help' ? [] : ['--data-dir', this.directory]), ...args], root); expect(result.code, `${name}: ${result.json?.code ?? result.json?.diagnostic?.code ?? 'unexpected status'}`).toBe(code); return result.json; }
    async settled(revision?: number) { if (revision !== undefined)
        await expect(this.page.locator('[data-sequence-summary]')).toContainText(`Saved revision ${revision}`); await expect(this.page.locator('[data-sequence-pending]')).toHaveAttribute('data-sequence-pending', 'false'); }
}
export async function measureInventory(a: Actions, name: string, stage: string) {
    const project = await invoke(['project', '--data-dir', a.directory], root);
    expect(project.code).toBe(0);
    const shot = project.json.shots.find((shot: any) => shot.name === name);
    expect(shot).toBeTruthy();
    const result = await invoke(['workspace', '--data-dir', a.directory, '--document-id', shot.documentId], root);
    expect(result.code).toBe(0);
    expect(result.json.inventory).toMatchObject({ slotCount: stage === 'imported' ? 1 : 2, trackCount: stage === 'imported' ? 1 : 2, unsupportedCount: 0, missingCount: 0 });
    a.inventories.push({ shot: name, stage, inventory: result.json.inventory });
}
export async function visibleShotMotion(page: Page, timeout = 2000) {
    const sample = () => page.locator('[data-preview]').evaluate((frame: HTMLIFrameElement) => {
        const caption = frame.contentDocument?.querySelector('[aria-label="Caption"]');
        if (!caption) return { opacity: 0, times: [] as number[] };
        const animations = frame.contentDocument!.getAnimations().filter(animation => {
            const effect = animation.effect as KeyframeEffect | null;
            return animation.constructor.name === 'CSSAnimation' && effect?.target === caption
                && effect.getKeyframes().some(keyframe => 'opacity' in keyframe);
        });
        return { opacity: Number(frame.contentWindow!.getComputedStyle(caption).opacity),
            times: animations.map(animation => Number(animation.currentTime)) };
    });
    let before = await sample(), after = before;
    await expect.poll(async () => { before = await sample(); return before.times.length; }, { timeout }).toBeGreaterThan(0);
    await expect.poll(async () => {
        after = await sample();
        return after.times.length === before.times.length && after.times.some((time, index) => time > before.times[index]!)
            && Math.abs(after.opacity - before.opacity) > 0.000001;
    }, { timeout, intervals: [16, 32, 50] }).toBe(true);
    return { before, after };
}
export async function uiShot(a: Actions, index: number) {
    const p = a.page, name = index ? 'Ending' : 'Opening';
    await a.click(p.locator('[data-new-shot] summary'));
    await a.fill(p.getByLabel('Shot name', { exact: true }), name);
    await a.select(p.getByLabel('Starting point'), 'Import HTML and CSS');
    await a.fill(p.getByLabel('Self-contained HTML and CSS'), await readFile(fixtures[index]!, 'utf8'));
    await a.click(p.getByRole('button', { name: 'Create shot', exact: true }));
    await expect(p.locator('[data-project-shot] option:checked')).toHaveText(name);
    await measureInventory(a, name, 'imported');
    await a.select(p.locator('[data-action-target]'), 'Caption');
    await a.click(p.getByRole('button', { name: 'Fade', exact: true }));
    await a.fill(p.locator('[data-action-form] [name=end]'), index ? '3000' : '2000');
    await a.click(p.getByRole('button', { name: 'Apply action', exact: true }));
    await expect(p.locator('[data-action-status]')).toContainText('Revision 1');
    await measureInventory(a, name, 'authored');
    await a.click(p.getByRole('button', { name: 'Play', exact: true }));
    a.motionProofs.push(await visibleShotMotion(p));
    await a.click(p.getByRole('button', { name: 'Pause', exact: true }));
    if (!a.firstMotionMs)
        a.firstMotionMs = Date.now() - a.started;
}
export async function cliShot(a: Actions, index: number) {
    const project = await a.cli('project'), id = index ? 'ending' : 'opening', name = index ? 'Ending' : 'Opening';
    await a.cli('shot-admit', ['--project-id', project.projectId, '--expected-catalog-revision', String(project.catalogRevision), '--document-id', id, '--name', name, '--html-file', fixtures[index]!, '--claim', id, '--operation-id', `admit-${id}`]);
    await measureInventory(a, name, 'imported');
    const workspace = await a.cli('workspace', ['--document-id', id]);
    const target = workspace.elements.find((el: any) => el.label === 'Caption');
    expect(target.actions).toContainEqual(expect.objectContaining({ action: 'fade', available: true }));
    await a.cli('track-create', ['--document-id', id, '--claim', id, '--element-id', target.elementId, '--duration-seconds', index ? '3' : '2', '--delay-seconds', '0', '--expected-revision', '0', '--operation-id', `fade-${id}`]);
    await a.cli('claim-release', ['--document-id', id, '--claim', id, '--expected-revision', '1', '--lease-version', '1', '--operation-id', `release-${id}`]);
    await measureInventory(a, name, 'authored');
    return id;
}
export async function uiSequence(a: Actions) {
    const p = a.page;
    await a.click(p.locator('[data-sequence-new] summary'));
    await a.fill(p.locator('[data-sequence-create] input'), 'Delivery animation');
    await expect.poll(() => p.locator('[data-sequence-create] select option').allTextContents()).toContain('Opening');
    await a.select(p.locator('[data-sequence-create] select'), 'Opening');
    await a.click(p.getByRole('button', { name: 'Create animation', exact: true }));
    await a.settled(0);
    await a.select(p.getByLabel('Saved shot to add'), 'Ending · 3 s');
    await a.click(p.getByRole('button', { name: 'Add shot', exact: true }));
    await a.settled(1);
    await a.click(p.getByRole('button', { name: 'Move Ending earlier', exact: true }));
    await a.settled(2);
    await a.click(p.locator('[data-clip-select]').filter({ hasText: /^Ending$/ }));
    await a.fill(p.getByLabel('End hold (seconds)'), '0.5');
    await a.click(p.getByRole('button', { name: 'Apply end hold', exact: true }));
    await a.settled(3);
    await a.click(p.getByRole('button', { name: 'Undo storyboard change', exact: true }));
    await a.settled(4);
    await a.click(p.getByRole('button', { name: 'Redo storyboard change', exact: true }));
    await a.settled(5);
}
export async function cliSequence(a: Actions) {
    const discovered = await a.cli('sequence-sources');
    const opening = discovered.shots.find((shot: any) => shot.name === 'Opening'), ending = discovered.shots.find((shot: any) => shot.name === 'Ending');
    const common = ['--sequence-id', 'delivery', '--claim', 'assembly'];
    const edit = (name: string, rev: number, args: string[] = []) => a.cli(name, [...common, '--expected-revision', String(rev), '--operation-id', `${name}-${rev}`, ...args]);
    await edit('sequence-create', 0, ['--name', 'Delivery animation', '--viewport-width', '320', '--viewport-height', '180', '--clip-id', 'opening', '--clip-name', 'Opening', '--source-document-id', opening.source.documentId, '--source-revision', String(opening.source.revision)]);
    await edit('sequence-clip-add', 0, ['--clip-id', 'ending', '--name', 'Ending', '--index', '1', '--source-document-id', ending.source.documentId, '--source-revision', String(ending.source.revision)]);
    await edit('sequence-clip-move', 1, ['--clip-id', 'ending', '--index', '0']);
    await edit('sequence-clip-hold', 2, ['--clip-id', 'ending', '--end-hold-seconds', '0.5']);
    await edit('sequence-undo', 3);
    await edit('sequence-redo', 4);
    await a.cli('sequence-claim-release', [...common, '--expected-revision', '5', '--lease-version', '1', '--operation-id', 'release-assembly']);
}
