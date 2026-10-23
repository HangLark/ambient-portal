import { test, expect } from '@playwright/test';
import { toggleListening } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__formatTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__formatTracks.push(...stream.getTracks());
      return stream;
    };
  });
});

const settings = (page) => page.locator('video').evaluate((video) => video.srcObject.getVideoTracks()[0].getSettings());
const start = async (page) => {
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
};

test('native widescreen and standard modes switch on the same track while audio continues', async ({ page }) => {
  await start(page);
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on the controlled device');
  await page.locator('#settings-open').click();
  for (const [format, ratio] of [['16:9', 16 / 9], ['4:3', 4 / 3], ['auto', null]]) {
    await page.getByLabel('Aspect ratio', { exact: true }).selectOption(format);
    await expect(page.locator('#camera-format')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#camera-format')).toHaveValue(format);
    await expect(page.locator('#format-notice')).toBeHidden();
    const actual = await settings(page);
    if (ratio) expect(Math.abs(actual.width / actual.height / ratio - 1)).toBeLessThanOrEqual(0.01);
    expect(actual.resizeMode).toBe('none');
    await expect(page.locator('#preview-detail')).toContainText(`${actual.width} × ${actual.height}`);
    await expect(page.locator('#preview-detail')).toContainText('Device native mode');
    await expect(page.locator('#playback-status')).toHaveText('Playing on the controlled device');
    expect(await page.locator('video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('contain');
  }
  expect(await page.evaluate(() => window.__formatTracks.length)).toBe(2);
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__formatTracks.every((track) => track.readyState === 'ended'))).toBe(true);
});

test('a rejected native ratio needs explicit crop permission and has translated, responsive feedback', async ({ page }, testInfo) => {
  await start(page);
  // Inject a driver refusal while keeping the real Chrome stream, settings, and crop path.
  await page.evaluate(() => {
    const track = window.__formatTracks[0];
    const apply = track.applyConstraints.bind(track);
    track.applyConstraints = (constraints) => constraints.aspectRatio?.max < 1 && constraints.resizeMode?.exact === 'none'
      ? Promise.reject(new DOMException('No native portrait mode', 'OverconstrainedError')) : apply(constraints);
  });
  const before = await settings(page);
  await page.locator('#settings-open').click();
  await page.locator('#camera-format').selectOption('9:16');
  await expect(page.locator('#allow-crop')).toBeVisible();
  await expect(page.locator('#camera-format')).toHaveValue('auto');
  expect(await settings(page)).toEqual(before);
  await expect(page.locator('#format-notice')).toContainText('previous picture is kept');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['narrow', 320, 760]]) {
    await page.setViewportSize({ width, height });
    for (const language of ['en-US', 'zh-CN']) {
      if (await page.locator('html').getAttribute('lang') !== language) { await page.keyboard.press('Escape'); await page.locator('#language').click(); await page.locator('#settings-open').click(); }
      await expect(page.locator('#allow-crop')).toContainText(language === 'en-US' ? 'Allow crop to fit' : '允许裁切适配');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`format-${name}-${language}.png`), fullPage: true });
    }
  }
  await page.locator('#allow-crop').click();
  await expect(page.locator('#camera-format')).toHaveValue('9:16');
  await expect(page.locator('#camera-format')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#format-notice')).toBeHidden();
  await expect(page.locator('#camera-format')).toBeFocused();
  const portrait = await settings(page);
  expect(Math.abs(portrait.width / portrait.height / (9 / 16) - 1)).toBeLessThanOrEqual(0.01);
  expect(portrait.resizeMode).toBe('crop-and-scale');
  await expect(page.locator('#preview-detail')).toContainText('浏览器适配');
  await page.screenshot({ path: testInfo.outputPath('portrait-zh-CN.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
  // Crop permission does not persist across sessions, even though the ratio preference does.
  await page.reload();
  await expect(page.locator('#camera-format')).toHaveValue('9:16');
  expect(await page.evaluate(() => window.__formatTracks.length)).toBe(0);
});

test('ignored constraints are detected rather than displaying a requested ratio as actual', async ({ page }) => {
  await start(page);
  const before = await settings(page);
  await page.evaluate(() => {
    const track = window.__formatTracks[0];
    const apply = track.applyConstraints.bind(track);
    track.applyConstraints = (constraints) => constraints.aspectRatio ? Promise.resolve() : apply(constraints);
  });
  await page.locator('#settings-open').click();
  await page.locator('#camera-format').selectOption('9:16');
  await expect(page.locator('#format-notice')).toBeVisible();
  await expect(page.locator('#camera-format')).toHaveValue('auto');
  expect(await settings(page)).toEqual(before);
  await expect(page.locator('#preview-detail')).not.toContainText('9:16');
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
});

test('rapid ratio changes serialize, coalesce, and can be stopped during negotiation', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const track = window.__formatTracks[0];
    const apply = track.applyConstraints.bind(track);
    window.__formatCalls = [];
    window.__inFlight = 0;
    window.__maxInFlight = 0;
    track.applyConstraints = async (constraints) => {
      window.__maxInFlight = Math.max(window.__maxInFlight, ++window.__inFlight);
      window.__formatCalls.push(constraints);
      if (window.__formatCalls.length === 1) await new Promise((resolve) => { window.__releaseFormat = resolve; });
      await apply(constraints);
      window.__inFlight--;
    };
  });
  await page.locator('#settings-open').click();
  await page.locator('#camera-format').selectOption('16:9');
  await expect(page.locator('#preview-status-text')).toHaveText('Switching…');
  await page.locator('#camera-format').selectOption('9:16');
  await page.locator('#camera-format').selectOption('4:3');
  expect(await page.evaluate(() => window.__formatCalls.length)).toBe(1);
  await page.evaluate(() => window.__releaseFormat());
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.locator('#camera-format')).toHaveValue('4:3');
  expect(await page.evaluate(() => window.__maxInFlight)).toBe(1);
  expect(await page.evaluate(() => window.__formatCalls.some((constraints) => constraints.aspectRatio?.max < 1))).toBe(false);
  await page.evaluate(() => {
    window.__formatTracks[0].applyConstraints = () => new Promise((resolve) => { window.__releaseFormat = resolve; });
  });
  await page.locator('#camera-format').selectOption('16:9');
  await expect(page.locator('#camera-format')).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
  await page.evaluate(() => window.__releaseFormat());
  await expect(page.locator('#preview-status-text')).toHaveText('Camera off');
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();
  expect(await page.evaluate(() => window.__formatTracks[0].readyState)).toBe('ended');
});

test('keyboard ratio selection persists without starting capture; blocked storage is harmless', async ({ page }) => {
  await page.goto('./');
  await page.locator('#settings-open').click();
  const select = page.getByLabel('Aspect ratio', { exact: true });
  await select.focus();
  // Type-ahead and Tab use the native select's keyboard path without an OS popup.
  await select.press('1');
  await select.press('Tab');
  await expect(select).toHaveValue('16:9');
  await page.reload();
  await expect(select).toHaveValue('16:9');
  expect(await page.evaluate(() => window.__formatTracks.length)).toBe(0);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.reload();
  await expect(select).toHaveValue('auto');
  await page.locator('#settings-open').click();
  await select.selectOption('4:3');
  await page.keyboard.press('Escape');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(select).toHaveValue('4:3');
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
});
