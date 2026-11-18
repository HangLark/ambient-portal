import { expect, test } from '@playwright/test';

test('fullscreen fits the whole camera frame with the controls open or closed', async ({ page }) => {
  await page.goto('./');
  await page.locator('#fullscreen').click();
  await page.locator('#empty-start').press('Enter');
  const toggle = page.getByRole('button', { name: 'Controls', exact: true });
  const video = page.locator('video');
  await expect(toggle).toBeFocused();
  await expect(video).toHaveCSS('object-fit', 'contain');
  const stream = await video.evaluateHandle(node => node.srcObject);

  for (const [width, height] of [[1366, 768], [844, 390], [667, 320], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    for (const expanded of [false, true]) {
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
      await expect.poll(() => video.boundingBox()).toEqual({ x: 0, y: 0, width, height });
      if (expanded) {
        const panel = page.locator('#capture-panel');
        await expect(panel).toBeInViewport({ ratio: 1 });
        expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        if (width > height) {
          expect(await video.evaluate(node => document.elementFromPoint(innerWidth / 2, innerHeight / 2) === node)).toBe(true);
        }
        await expect(page.locator('#settings-open')).toBeInViewport({ ratio: 1 });
      } else {
        await expect(page.locator('#camera-button')).toBeHidden();
      }
      await toggle.press('Space');
    }
  }

  await page.evaluate(() => document.exitFullscreen());
  await expect(toggle).toBeHidden();
  await expect(page.locator('#fullscreen')).toBeFocused();
  await expect(page.locator('#camera-button')).toBeVisible();
  expect(await video.evaluate((node, original) => node.srcObject === original, stream)).toBe(true);
});

test.describe('touch fullscreen', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 }, locale: 'zh-CN' });

  test('the toolbar gets out of the way and returns to touch or keyboard', async ({ page }) => {
    await page.goto('./');
    await page.locator('#empty-start').tap();
    await expect(page.locator('#stage')).toHaveAttribute('data-state', 'active');
    await page.locator('#fullscreen').tap();
    const toolbar = page.locator('.panel-toolbar');
    const toggle = page.getByRole('button', { name: '控制栏' });
    await expect(toolbar).toHaveCSS('opacity', '0', { timeout: 7000 });
    await expect(toolbar).toHaveCSS('pointer-events', 'none');
    await page.touchscreen.tap(20, 20);
    await expect(toolbar).toHaveCSS('opacity', '1');
    await toggle.tap();
    await expect(page.locator('#preview-detail')).toBeVisible();
    await page.locator('#settings-open').tap();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.touchscreen.tap(20, 20);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toolbar).toHaveCSS('opacity', '0', { timeout: 7000 });
    await page.keyboard.press('Tab');
    await expect(page.locator('#fullscreen')).toBeFocused();
    await expect(toolbar).toHaveCSS('opacity', '1');
  });
});
