import { expect, test } from '@playwright/test';

test('ignores a transient zero-width preview resize and recovers its projection', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();

  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.preview-stage')!;
    stage.style.display = 'none';
    window.dispatchEvent(new Event('resize'));
    stage.style.display = '';
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(50);

  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-preview-canvas]')!;
    const scale = Number(canvas.style.transform.match(/^scale\(([^)]+)\)$/)?.[1]);
    return { finitePositiveScale: Number.isFinite(scale) && scale > 0,
      sourceMatchesCompiler: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc
        === window.__motionEditor.compiledHtml };
  })).toEqual({ finitePositiveScale: true, sourceMatchesCompiler: true });
});
