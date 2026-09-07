import { expect, test } from './test-fixture.ts';
import { visibleShotMotion } from './animation-delivery-helpers.ts';

test('first-motion proof rejects static and frozen positive opacity but accepts native progression', async ({ page }) => {
    await page.setContent('<iframe data-preview></iframe>');
    const setScene = async (animated: boolean) => page.locator('[data-preview]').evaluate(async (frame: HTMLIFrameElement, animated) => {
        await new Promise<void>(resolve => {
            frame.onload = () => resolve();
            frame.srcdoc = `<style>p{opacity:1;${animated ? 'animation:fade 20s linear both' : ''}}@keyframes fade{from{opacity:0}to{opacity:1}}</style><p aria-label="Caption">Public motion probe</p>`;
        });
    }, animated);
    await setScene(false);
    await expect(visibleShotMotion(page, 150)).rejects.toThrow();
    await setScene(true);
    await page.locator('[data-preview]').evaluate((frame: HTMLIFrameElement) => {
        const animation = frame.contentDocument!.getAnimations()[0]!;
        animation.pause(); animation.currentTime = 10000;
    });
    await expect(visibleShotMotion(page, 150)).rejects.toThrow();
    await page.locator('[data-preview]').evaluate((frame: HTMLIFrameElement) => frame.contentDocument!.getAnimations()[0]!.play());
    const proof = await visibleShotMotion(page);
    expect(proof.after.times[0]).toBeGreaterThan(proof.before.times[0]!);
    expect(proof.after.opacity).toBeGreaterThan(proof.before.opacity);
});
