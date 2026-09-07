import { expect, test } from './test-fixture.ts';
import { Actions, environment, uiShot, uiSequence } from './animation-delivery-helpers.ts';

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('normal shot and storyboard controls meet rendered target and contrast requirements', async ({ page }) => {
  const env = await environment();
  try {
    const a = new Actions(page, env.directory);
    await a.navigate(env.app.editorUrl);
    await uiShot(a, 0); await uiShot(a, 1); await uiSequence(a);
    const fullPlay = page.getByRole('button', { name: 'Play all', exact: true });
    const shotPlay = page.getByRole('button', { name: 'Play', exact: true });
    const download = page.getByRole('button', { name: 'Download animation', exact: true });
    const activity = page.locator('.collaboration-details > summary');
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      for (const control of [fullPlay, shotPlay, download]) {
        await expect(control).toBeEnabled();
        const colors = await control.evaluate(element => {
          const style = getComputedStyle(element);
          let parent = element.parentElement!;
          while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement!;
          return { text: style.color, background: style.backgroundColor, border: style.borderTopColor,
            adjacent: getComputedStyle(parent).backgroundColor };
        });
        expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.border, colors.background)).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.border, colors.adjacent)).toBeGreaterThanOrEqual(3);
        if (viewport.width === 390) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      const bounds = (await activity.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(24); expect(bounds.height).toBeGreaterThanOrEqual(24);
    }
    await activity.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.collaboration-details')).toHaveAttribute('open', '');
    await page.keyboard.press('Enter'); await expect(page.locator('.collaboration-details')).not.toHaveAttribute('open');
    await download.focus();
    const focus = await download.evaluate(element => {
      const style = getComputedStyle(element);
      return { width: parseFloat(style.outlineWidth), color: style.outlineColor, background: style.backgroundColor };
    });
    expect(focus.width).toBeGreaterThanOrEqual(2); expect(contrast(focus.color, focus.background)).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await expect(download).toBeFocused();
    await shotPlay.click(); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  } finally { await env.cleanup(); }
});
