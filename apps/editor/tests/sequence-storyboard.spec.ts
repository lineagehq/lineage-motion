import { expect, test } from './test-fixture.ts';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { SequenceServiceClient } from '../../../packages/motion-protocol/src/sequence-client.ts';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnTestServer, stopTestServer, waitForTestServer } from './test-server.ts';
const root = resolve(import.meta.dirname, '../../..');
async function launch() {
  const directory = await mkdtemp(join(tmpdir(), 'motion-storyboard-'));
  const child = spawnTestServer(process.execPath, ['--import', 'tsx', resolve(root, 'apps/editor/scripts/dev-editor.mjs'), '--data-dir', directory, '--project', 'Storyboard proof', '--port', '0'], { cwd: root });
  try { const result = await waitForTestServer(child); const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0,24);
    const session = JSON.parse(await readFile(join(directory,digest(root),digest('Storyboard proof'),'session.json'),'utf8'));
    return { ...result, session, directory, cleanup: async () => { await stopTestServer(child); await rm(directory, { recursive: true, force: true }); } }; }
  catch (error) { await stopTestServer(child); await rm(directory, { recursive: true, force: true }); throw error; }
}
const source = (color: string, duration: number) => `<!doctype html><html><head><style>html,body{margin:0;width:320px;height:180px;overflow:hidden;background:${color}}.actor{width:30px;height:30px;background:black;animation:move ${duration}ms linear both}@keyframes move{from{transform:translateX(0px)}to{transform:translateX(120px)}}@media(prefers-reduced-motion:reduce){.actor{animation:none;transform:translateX(40px)}}</style></head><body><div class="actor"></div><span></span></body></html>`;
async function shot(page: Page, name: string, color: string, duration: number, html = source(color, duration)) {
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill(name);
  await page.getByLabel('Starting point').selectOption('html-css'); await page.getByLabel('Self-contained HTML and CSS').fill(html);
  await page.getByRole('button', { name: 'Create shot', exact: true }).click(); await expect(page.locator('[data-project-shot] option:checked')).toHaveText(name);
}
async function revision(page: Page, number: number, settled = true) { await expect(page.locator('[data-sequence-summary]')).toContainText(`Saved revision ${number}`); if (settled) await expect(page.locator('[data-sequence-pending]')).toHaveAttribute('data-sequence-pending','false'); }
async function create(page: Page, settled = true) {
  await page.locator('[data-sequence-new] summary').click(); await page.locator('[data-sequence-create] input').fill('Two shot animation');
  await expect.poll(() => page.locator('[data-sequence-create] select option').allTextContents()).toEqual(expect.arrayContaining(['Red opening', 'Blue ending']));
  await page.locator('[data-sequence-create] select').selectOption({ label: 'Red opening' });
  await page.getByRole('button', { name: 'Create animation', exact: true }).click(); await revision(page, 0, settled);
}

test('storyboard edits committed occurrences, preserves pins, crosses exact cuts and keeps controls reachable', async ({ page }) => {
  test.setTimeout(90000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page, 'Red opening', 'red', 2000); await shot(page, 'Blue ending', 'blue', 3000); await create(page);
    await page.getByLabel('Saved shot to add').selectOption({ label: 'Blue ending · 3 s' }); await page.getByRole('button', { name: 'Add shot', exact: true }).click(); await revision(page, 1);
    await expect(page.locator('[data-sequence-summary]')).toContainText('2 shots · 5 s');
    await expect(page.locator('[data-sequence-play]')).toBeEnabled();
    for (const [time, color] of [[1999,'rgb(255, 0, 0)'],[2000,'rgb(0, 0, 255)'],[2001,'rgb(0, 0, 255)'],[5000,'rgb(0, 0, 255)']] as const) {
      await page.locator('[data-sequence-scrub]').evaluate((input: HTMLInputElement, time) => { input.value = String(time); input.dispatchEvent(new Event('input', { bubbles: true })); }, time);
      const observed = await page.locator('[data-sequence-preview] iframe').evaluate((frame: HTMLIFrameElement) => {
        const child = [...frame.contentDocument!.querySelectorAll('iframe')].find(child => child.style.visibility === 'visible')!;
        return child.contentWindow!.getComputedStyle(child.contentDocument!.body).backgroundColor;
      }); expect(observed).toBe(color);
    }
    const cards = page.locator('[data-sequence-cards] > li');
    await cards.first().getByRole('button', { name: 'Duplicate occurrence' }).click(); await revision(page, 2);
    await cards.nth(1).locator('[data-clip-select]').click();
    await page.getByLabel('Occurrence name', { exact: true }).fill('Red reprise'); await page.getByRole('button', { name: 'Apply occurrence name' }).press('Enter'); await revision(page, 3);
    await page.getByLabel('End hold (seconds)').fill('0.5'); await page.getByRole('button', { name: 'Apply end hold' }).press('Enter'); await revision(page, 4);
    await expect(cards.nth(1)).toContainText('hold 0.5 s'); await expect(cards.first()).not.toContainText('hold');
    await cards.nth(1).getByRole('button', { name: 'Move Red reprise later' }).press('Enter'); await revision(page, 5);
    await expect(cards.locator('[data-clip-select]')).toHaveText(['Red opening','Blue ending','Red reprise']);
    await cards.nth(2).getByRole('button', { name: 'Remove occurrence' }).click(); await revision(page, 6);
    await page.getByRole('button', { name: 'Undo storyboard change' }).press('Enter'); await revision(page, 7);
    await page.getByRole('button', { name: 'Redo storyboard change' }).press('Enter'); await revision(page, 8);
    await page.reload(); await revision(page, 8); await expect(cards.locator('[data-clip-select]')).toHaveText(['Red opening','Blue ending']);
    await cards.first().locator('[data-clip-select]').click(); await page.getByLabel('End hold (seconds)').fill('-1'); await page.getByRole('button', { name: 'Apply end hold' }).click();
    await expect(page.getByLabel('End hold (seconds)')).toBeFocused(); await revision(page, 8);
    await page.getByRole('button', { name: 'Discard storyboard draft' }).click();
    for (const size of [{ width:1280,height:720 },{ width:1440,height:900 },{ width:390,height:844 }]) {
      await page.setViewportSize(size); await page.getByRole('button', { name: 'Play all', exact:true }).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Play all', exact:true }).click(); await page.getByRole('button', { name: 'Pause all', exact:true }).click();
      await page.screenshot({ path: test.info().outputPath(`storyboard-${size.width}.png`) });
    }
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download full animation' }).click(); expect((await event).suggestedFilename()).toContain('sequence-r8');
  } finally { await app.cleanup(); }
});

test('invalid end hold explains both constraints and preserves draft, focus, saved preview and recovery', async ({ page }) => {
  const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page, 'Red opening', 'red', 2000); await shot(page, 'Blue ending', 'blue', 3000); await create(page);
    const hold = page.getByLabel('End hold (seconds)');
    const savedPreview = await page.locator('[data-sequence-preview] iframe').getAttribute('srcdoc');
    let writes = 0; page.on('request', request => { if (request.url().endsWith('/api/sequence/v1/commands')) writes++; });
    for (const invalid of ['-1', '0.0001']) {
      await hold.fill(invalid); await page.getByRole('button', { name: 'Apply end hold' }).press('Enter');
      await expect(page.locator('[data-sequence-status]')).toHaveText('Hold not applied. Enter zero or more seconds with at most three decimal places.');
      await expect(hold).toBeFocused(); await expect(hold).toHaveValue(invalid); await revision(page, 0);
      expect(await page.locator('[data-sequence-preview] iframe').getAttribute('srcdoc')).toBe(savedPreview);
      expect(writes).toBe(0);
    }
    await hold.fill('0.3'); await page.getByRole('button', { name: 'Apply end hold' }).press('Enter'); await revision(page, 1);
    await expect(page.locator('[data-sequence-cards]')).toContainText('hold 0.3 s'); expect(writes).toBe(1);
  } finally { await app.cleanup(); }
});

test('storyboard draft stays visible during agent updates and shot navigation requires explicit discard', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page, 'Red opening', 'red', 2000); await shot(page, 'Blue ending', 'blue', 3000); await create(page);
    await page.getByLabel('End hold (seconds)').fill('0.75');
    await page.locator('[data-sequence-cards] [data-clip-open]').click(); await expect(page.locator('[data-sequence-leave]')).toBeVisible();
    await page.getByRole('button', { name: 'Stay here', exact:true }).filter({ visible:true }).click();
    await expect(page.getByLabel('End hold (seconds)')).toHaveValue('0.75');
    const client = new SequenceServiceClient(app.serviceUrl, { actor:'agent', capability:app.session.agentCapability, claimSecret:randomBytes(32).toString('hex') });
    const sequenceId = await page.locator('[data-sequence-select]').inputValue();
    const base = { protocolVersion:'motion.sequence-protocol.v1' as const,projectId:app.session.projectId,sequenceId,expectedRevision:0 };
    const acquired = await client.execute({ ...base,kind:'sequence.claim.acquire',operationId:'agent-acquire' });
    if (!acquired.ok || !acquired.claim) throw new Error('CLAIM_REQUIRED');
    expect(await client.execute({ ...base,kind:'sequence.edit',operationId:'agent-name',edit:{kind:'sequence.rename',name:'Agent refined animation'} })).toMatchObject({ok:true,revision:1});
    await revision(page,1); await expect(page.locator('[data-sequence-conflict]')).toBeVisible();
    await expect(page.getByLabel('End hold (seconds)')).toHaveValue('0.75');
    expect(await client.execute({ ...base,kind:'sequence.claim.release',operationId:'agent-release',expectedRevision:1,claimId:acquired.claim.claimId,expectedLeaseVersion:1 })).toMatchObject({ok:true});
    await page.getByRole('button',{name:'Discard storyboard draft'}).click();
    await page.getByLabel('End hold (seconds)').fill('0.75');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let request!: () => void; const reached = new Promise<void>(resolve => { request = resolve; });
    await page.route('**/api/sequence/v1/commands', async route => { request(); await gate; await route.continue(); });
    await page.getByRole('button', { name: 'Apply end hold' }).click(); await reached;
    await expect(page.locator('[data-sequence-status]')).toContainText('Saving'); await expect(page.locator('[data-sequence-select]')).toBeDisabled();
    release(); await revision(page,2); await page.unroute('**/api/sequence/v1/commands');
    await page.locator('[data-sequence-cards] [data-clip-action=duplicate]').click(); await revision(page,3);
    await page.locator('[data-sequence-cards] [data-clip-open]').first().click(); await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Red opening'); await revision(page,3);
    await page.getByRole('button', {name:'Fade',exact:true}).click(); await page.locator('[data-action-form] [name="end"]').fill('1200');
    await page.locator('[data-project-shot]').selectOption({ label:'Blue ending' }); await expect(page.locator('[data-shot-switch]')).toBeVisible();
    await page.locator('[data-shot-stay]').click(); await expect(page.locator('[data-action-form] [name="end"]')).toHaveValue('1200');
    await page.getByRole('button',{name:'Apply action',exact:true}).click(); await expect(page.locator('[data-action-status]')).toContainText('Revision 1');
    await expect(page.locator('[data-clip-update]')).toHaveCount(2); await revision(page,3);
    await page.locator('[data-clip-update]').nth(1).click(); await revision(page,4);
    await expect(page.locator('[data-sequence-cards] > li').first()).toContainText('Pinned shot revision 0');
    await expect(page.locator('[data-sequence-cards] > li').nth(1)).toContainText('Pinned shot revision 1');
  } finally { await app.cleanup(); }
});

test('lost responses retry one exact change and preserve other draft fields and animation selection', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000); await create(page);
    await page.getByLabel('Occurrence name',{exact:true}).fill('Retained occurrence'); await page.getByLabel('End hold (seconds)').fill('1.001');
    const ids: string[] = []; let first = true;
    await page.route('**/api/sequence/v1/commands', async route => {
      ids.push(route.request().postDataJSON().operationId);
      if (first) { first = false; await route.fetch(); await route.abort('connectionrefused'); } else await route.continue();
    });
    await page.getByRole('button',{name:'Apply end hold'}).click(); await expect(page.getByRole('button',{name:'Retry unconfirmed change'})).toBeVisible();
    await expect(page.getByLabel('End hold (seconds)')).toHaveValue('1.001');
    await page.getByRole('button',{name:'Retry unconfirmed change'}).click(); await revision(page,1);
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
    await expect(page.getByLabel('Occurrence name',{exact:true})).toHaveValue('Retained occurrence');
    await expect(page.locator('[data-sequence-cards]')).toContainText('hold 1.001 s');
    await page.getByRole('button',{name:'Apply occurrence name'}).click(); await revision(page,2);
    await page.locator('[data-sequence-name] input').fill('Renamed animation'); await page.getByRole('button',{name:'Rename animation',exact:true}).press('Enter'); await revision(page,3);
    await page.locator('[data-sequence-create] input').fill('Second animation'); await page.getByRole('button',{name:'Create animation',exact:true}).click(); await revision(page,0);
    await page.getByLabel('Current animation').selectOption({label:'Renamed animation'}); await revision(page,3);
    await expect(page.locator('[data-sequence-cards]')).toContainText('Retained occurrence');
    await expect(page.locator('[data-sequence-summary]')).toContainText('3.001 s');
  } finally { await app.cleanup(); }
});

test('same-revision preview retries once explicitly and successful refresh preserves the native frame', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000);
    let exports = 0;
    await page.route('**/api/sequence/v1/export', async route => {
      exports++; if (exports === 1) await route.fulfill({status:503,contentType:'application/json',body:'{}'}); else await route.continue();
    });
    await create(page); await expect(page.locator('[data-sequence-preview-status]')).toContainText('Refresh the storyboard to retry');
    await expect(page.getByRole('button',{name:'Play all',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Refresh storyboard'}).click();
    await expect(page.getByRole('button',{name:'Play all',exact:true})).toBeEnabled(); expect(exports).toBe(2); await revision(page,0);
    await page.locator('[data-sequence-scrub]').evaluate((input:HTMLInputElement) => { input.value='1234'; input.dispatchEvent(new Event('input',{bubbles:true})); });
    await expect(page.locator('[data-sequence-time]')).toHaveText('1.234 s');
    await page.getByRole('button',{name:'Refresh storyboard'}).click();
    await expect(page.locator('[data-sequence-time]')).toHaveText('1.234 s'); expect(exports).toBe(2);
  } finally { await app.cleanup(); }
});

test('pending save locks editable drafts until acknowledgement then permits the next independent name', async ({ page }) => {
  test.setTimeout(60000); const app = await launch(); let release = () => {};
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000); await create(page);
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/sequence/v1/commands', async route => { const response = await route.fetch(); await gate; await route.fulfill({response}); });
    await page.getByLabel('Occurrence name',{exact:true}).fill('First acknowledged name'); await page.getByRole('button',{name:'Apply occurrence name'}).click();
    await expect(page.locator('[data-sequence-status]')).toContainText('Saving');
    for (const input of [page.getByLabel('Occurrence name',{exact:true}),page.getByLabel('End hold (seconds)'),page.getByLabel('Animation name draft')]) await expect(input).toBeDisabled();
    release(); await revision(page,1); await page.unroute('**/api/sequence/v1/commands');
    await expect(page.getByLabel('Occurrence name',{exact:true})).toBeEnabled();
    await page.getByLabel('Occurrence name',{exact:true}).fill('Next independent name'); await page.getByRole('button',{name:'Apply occurrence name'}).click(); await revision(page,2);
    await expect(page.locator('[data-sequence-cards] [data-clip-select]')).toHaveText('Next independent name');
  } finally { release(); await app.cleanup(); }
});

test('whitespace names reject locally without uncertain retries and corrected names save normally', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000);
    let commands = 0; page.on('request', request => { if (request.url().endsWith('/api/sequence/v1/commands')) commands++; });
    await page.locator('[data-sequence-new] summary').click(); await page.locator('[data-sequence-create] input').fill('   ');
    await page.getByRole('button',{name:'Create animation',exact:true}).click();
    await expect(page.locator('[data-sequence-status]')).toContainText('Names must contain text'); expect(commands).toBe(0);
    await expect(page.getByRole('button',{name:'Retry unconfirmed change'})).toBeHidden();
    await page.locator('[data-sequence-create] input').fill('Valid animation'); await page.locator('[data-sequence-create] select').selectOption({label:'Red opening'});
    await page.getByRole('button',{name:'Create animation',exact:true}).click(); await revision(page,0); expect(commands).toBe(1);
    for (const [label,button,valid] of [['Occurrence name','Apply occurrence name','Valid occurrence'],['Animation name draft','Rename animation','Renamed valid animation']]) {
      const before = commands; await page.getByLabel(label!,{exact:true}).fill('   '); await page.getByRole('button',{name:button!,exact:true}).click();
      await expect(page.locator('[data-sequence-status]')).toContainText('Names must contain text'); expect(commands).toBe(before);
      await expect(page.getByRole('button',{name:'Retry unconfirmed change'})).toBeHidden(); await expect(page.getByLabel(label!,{exact:true})).toBeEnabled();
      await page.getByLabel(label!,{exact:true}).fill(valid!); await page.getByRole('button',{name:button!,exact:true}).click(); await revision(page,before); expect(commands).toBe(before+1);
    }
  } finally { await app.cleanup(); }
});

test('full playback status reports actual pause and natural completion', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000); await create(page);
    const status = page.locator('[data-sequence-preview-status]');
    await page.getByRole('button',{name:'Play all',exact:true}).click(); await expect(status).toHaveText('Playing the saved full animation.');
    await page.getByRole('button',{name:'Pause all',exact:true}).click(); await expect(status).toHaveText('Saved full animation paused.');
    await page.locator('[data-sequence-scrub]').evaluate((input:HTMLInputElement) => { input.value='1999'; input.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.getByRole('button',{name:'Play all',exact:true}).click(); await expect(status).toHaveText('Full animation complete.');
    await expect(page.locator('[data-sequence-time]')).toHaveText('2 s');
    await page.getByRole('button',{name:'Pause all',exact:true}).click(); await expect(status).toHaveText('Full animation complete.');
    await page.getByRole('button',{name:'Play all',exact:true}).click(); await expect(status).toHaveText('Full animation complete.');
  } finally { await app.cleanup(); }
});

test('loading exports cannot accept overlapping edits or download an older acknowledged revision', async ({ page }) => {
  test.setTimeout(60000); const app = await launch(); let release = () => {};
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000);
    let gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/sequence/v1/export', async route => { const response = await route.fetch(); await gate; await route.fulfill({response}); });
    await create(page,false);
    await expect(page.getByLabel('Occurrence name',{exact:true})).toBeDisabled(); await expect(page.getByRole('button',{name:'Download full animation'})).toBeDisabled();
    release(); await expect(page.getByRole('button',{name:'Download full animation'})).toBeEnabled();
    gate = new Promise<void>(resolve => { release = resolve; });
    await page.getByLabel('Occurrence name',{exact:true}).fill('Newest committed occurrence'); await page.getByRole('button',{name:'Apply occurrence name'}).click(); await revision(page,1,false);
    await expect(page.getByRole('button',{name:'Download full animation'})).toBeDisabled(); await expect(page.getByLabel('Occurrence name',{exact:true})).toBeDisabled();
    release(); await expect(page.locator('[data-sequence-preview-status]')).toContainText('revision 1');
    await expect(page.locator('[data-sequence-status]')).toHaveText('Storyboard saved · revision 1.');
    const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Download full animation'}).click(); expect((await download).suggestedFilename()).toBe('animation-sequence-r1.zip');
    await expect(page.locator('[data-sequence-cards]')).toContainText('Newest committed occurrence');
  } finally { release(); await app.cleanup(); }
});

test('same-revision sequence switch locks old inputs while the new identity loads', async ({ page }) => {
  test.setTimeout(60000); const app = await launch(); let release = () => {};
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000); await create(page);
    const first = await page.getByLabel('Current animation').inputValue();
    await page.locator('[data-sequence-create] input').fill('Second animation'); await page.getByRole('button',{name:'Create animation',exact:true}).click();
    await expect(page.locator('[data-sequence-summary]')).toContainText('Second animation');
    const second = await page.getByLabel('Current animation').inputValue();
    await page.getByLabel('Current animation').selectOption(first); await expect(page.locator('[data-sequence-summary]')).toContainText('Two shot animation');
    const gate = new Promise<void>(resolve => { release = resolve; }); let reached!:()=>void; const requested = new Promise<void>(resolve=>{reached=resolve;});
    await page.route(`**/api/sequence/v1/sequences/${second}`,async route=>{reached(); await gate; await route.continue();});
    await page.getByLabel('Current animation').selectOption(second); await requested;
    await expect(page.getByLabel('Occurrence name',{exact:true})).toBeDisabled(); await expect(page.getByLabel('Animation name draft')).toBeDisabled();
    await expect(page.getByRole('button',{name:'Apply occurrence name'})).toBeDisabled();
    release(); await expect(page.locator('[data-sequence-summary]')).toContainText('Second animation');
    await expect(page.getByLabel('Animation name draft')).toHaveValue('Second animation');
    await page.getByLabel('Occurrence name',{exact:true}).fill('Second identity only'); await page.getByRole('button',{name:'Apply occurrence name'}).click(); await revision(page,1);
    await page.getByLabel('Current animation').selectOption(first); await revision(page,0);
    await expect(page.locator('[data-sequence-cards] [data-clip-select]')).toHaveText('Red opening');
  } finally { release(); await app.cleanup(); }
});

test('agent-admitted source opens through the existing shot draft guard without reloading the catalog first', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',2000); await shot(page,'Blue ending','blue',3000); await create(page);
    const cli = (...args:string[]) => JSON.parse(execFileSync(process.execPath,['--import','tsx',resolve(root,'packages/motion-cli/src/cli.ts'),...args,'--data-dir',app.directory],{cwd:root,encoding:'utf8'}));
    const catalog = cli('project'); const path=join(app.directory,'agent-green.html'); await writeFile(path,source('green',1000));
    expect(cli('shot-admit','--project-id',app.session.projectId,'--expected-catalog-revision',String(catalog.catalogRevision),'--document-id','agent_green','--name','Agent green','--claim','green','--html-file',path,'--operation-id','admit-green')).toMatchObject({ok:true});
    await expect(page.locator('[data-sequence-source] option[value="agent_green"]')).toHaveText('Agent green · 1 s');
    await expect(page.locator('[data-project-shot] option[value="agent_green"]')).toHaveCount(0);
    await page.getByLabel('Saved shot to add').selectOption('agent_green'); await page.getByRole('button',{name:'Add shot',exact:true}).click(); await revision(page,1);
    await page.getByRole('button',{name:'Fade',exact:true}).click(); await page.locator('[data-action-form] [name="end"]').fill('1200');
    await page.locator('[data-sequence-cards] > li').last().getByRole('button',{name:'Edit source shot'}).click();
    await expect(page.locator('[data-shot-switch]')).toBeVisible(); await page.locator('[data-shot-stay]').click();
    await expect(page.locator('[data-action-form] [name="end"]')).toHaveValue('1200');
    await page.locator('[data-sequence-cards] > li').last().getByRole('button',{name:'Edit source shot'}).click(); await page.locator('[data-shot-discard]').click();
    await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Agent green'); await expect(page.getByRole('heading',{name:'Shape your shot'})).toBeVisible();
    expect(new URL(page.url()).searchParams.get('shot')).toBe('agent_green'); await revision(page,1);
  } finally { await app.cleanup(); }
});

test('normal full preview pauses actual native transform and opacity identically to the downloaded artifact', async ({ page, context }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    const html = source('red',3000).replace('animation:move 3000ms linear both','animation:move 3000ms linear both,fade 3000ms linear both').replace('@media(', '@keyframes fade{from{opacity:0}to{opacity:1}}@media(');
    await page.goto(app.editorUrl); await shot(page,'Red opening','red',3000,html); await shot(page,'Blue ending','blue',3000); await create(page);
    await page.locator('[data-sequence-scrub]').evaluate((input:HTMLInputElement) => { input.value='1500'; input.dispatchEvent(new Event('input',{bubbles:true})); });
    const sample = () => page.locator('[data-sequence-preview] iframe').evaluate((frame:HTMLIFrameElement) => {
      const child = [...frame.contentDocument!.querySelectorAll('iframe')].find(frame=>frame.style.visibility==='visible')!;
      const style=child.contentWindow!.getComputedStyle(child.contentDocument!.querySelector('.actor')!);
      return {transform:style.transform,opacity:style.opacity,animations:child.contentDocument!.getAnimations().map(a=>({state:a.playState,time:a.currentTime}))};
    });
    const before = await sample(); expect(before).toEqual({transform:'matrix(1, 0, 0, 1, 60, 0)',opacity:'0.5',animations:[{state:'paused',time:1500},{state:'paused',time:1500}]});
    await page.waitForTimeout(180); expect(await sample()).toEqual(before);
    const event = page.waitForEvent('download'); await page.getByRole('button',{name:'Download full animation'}).click();
    const archive=join(app.directory,'native-proof.zip'); await (await event).saveAs(archive);
    const exportedHtml=execFileSync('unzip',['-p',archive,'animation.html'],{encoding:'utf8'});
    const standalone=await context.newPage(); await standalone.setContent(exportedHtml);
    const exported=await standalone.evaluate(async()=>{
      const runtime=(window as any).__motionSequence; await runtime.ready; runtime.pause(); runtime.seek(1500);
      const child=[...document.querySelectorAll('iframe')].find(frame=>frame.style.visibility==='visible')!;
      const style=child.contentWindow!.getComputedStyle(child.contentDocument!.querySelector('.actor')!);
      return {transform:style.transform,opacity:style.opacity,animations:child.contentDocument!.getAnimations().map(a=>({state:a.playState,time:a.currentTime}))};
    }); expect(exported).toEqual(before); await standalone.close();
  } finally { await app.cleanup(); }
});

test('unavailable storyboard catalog does not block independent shot creation or navigation', async ({ page }) => {
  test.setTimeout(60000); const app = await launch();
  try {
    await page.route('**/api/sequence/v1/catalog',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await page.goto(app.editorUrl); await expect(page.locator('[data-sequence-status]')).toContainText('Could not refresh');
    await page.getByRole('button',{name:'Create or import a shot',exact:true}).click(); await expect(page.getByLabel('Shot name',{exact:true})).toBeFocused();
    await page.locator('[data-new-shot] summary').click();
    await shot(page,'Red opening','red',2000); await expect(page.locator('[data-sequence-status]')).toContainText('Could not refresh');
    await shot(page,'Blue ending','blue',3000); await expect(page.locator('[data-sequence-status]')).toContainText('Could not refresh');
    await page.locator('[data-project-shot]').selectOption({label:'Red opening'});
    await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Red opening');
    await expect(page.getByRole('heading',{name:'Shape your shot'})).toBeVisible();
  } finally { await app.cleanup(); }
});
