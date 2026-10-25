import { test, expect } from '@playwright/test';
import { toggleListening } from './helpers.js';

async function observeAudio(page) {
  await page.addInitScript(() => {
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      window.__volumeGain = node;
      return node;
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__volumeCaptures = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__volumeCaptures.push(stream);
      return stream;
    };
  });
}

async function sliderPoint(page, percent) {
  const rect = await page.locator('#volume').boundingBox();
  // Native range thumb centers travel between its two 7px end insets.
  return { x: rect.x + 7 + (rect.width - 14) * percent / 200, y: rect.y + rect.height / 2 };
}

async function expectVolume(page, percent) {
  await expect(page.locator('#volume')).toBeEnabled();
  await expect(page.locator('#volume')).toHaveValue(String(percent));
  await expect(page.locator('#volume-value')).toHaveText(`${percent}%`);
  await expect.poll(() => page.evaluate(() => window.__volumeGain.gain.value)).toBeCloseTo(percent / 100, 2);
}

test('mouse dragging settles at meaningful levels, leaves each stop freely, and keeps keyboard precision', async ({ page }) => {
  await observeAudio(page);
  await page.goto('./');
  await toggleListening(page);
  await expectVolume(page, 35);
  const start = await sliderPoint(page, 35);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const [requested, expected] of [[98, 100], [102, 100], [110, 110], [37, 35], [34, 35], [45, 45]]) {
    const point = await sliderPoint(page, requested);
    await page.mouse.move(point.x, point.y, { steps: 6 });
    await expectVolume(page, expected);
  }
  await page.mouse.up();
  await page.locator('#volume').press('Home');
  await expectVolume(page, 0);
  await page.locator('#volume').press('End');
  await expectVolume(page, 200);
  const unity = await sliderPoint(page, 99);
  await page.mouse.click(unity.x, unity.y);
  await expectVolume(page, 100);
  await expect(page.locator('#volume')).toHaveAttribute('aria-valuetext', '100% · Original level');
  await page.locator('#volume').press('ArrowRight');
  await expectVolume(page, 101);
  await expect(page.locator('#volume-boost-hint')).toBeVisible();
  await page.locator('#volume').press('ArrowLeft');
  await expectVolume(page, 100);
  await page.locator('#volume').press('ArrowLeft');
  await expectVolume(page, 99);
  const defaultPoint = await sliderPoint(page, 35);
  await page.mouse.click(defaultPoint.x, defaultPoint.y);
  await expectVolume(page, 35);
  await page.locator('#volume').press('ArrowRight');
  await expectVolume(page, 36);
  expect(await page.evaluate(() => window.__volumeCaptures.length)).toBe(1);
  expect(await page.evaluate(() => window.__volumeCaptures[0].getTracks().every((track) => track.readyState === 'live'))).toBe(true);
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__volumeCaptures[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
});

test('touch dragging snaps on a phone and cancellation cannot trap later precise input', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  try {
    const page = await context.newPage();
    await observeAudio(page);
    await page.goto(baseURL);
    await toggleListening(page);
    await expectVolume(page, 35);
    const touch = await context.newCDPSession(page);
    const start = await sliderPoint(page, 35);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (const [requested, expected] of [[102, 100], [32, 35]]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [await sliderPoint(page, requested)] });
      await expectVolume(page, expected);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.locator('#volume').press('ArrowRight');
    await expectVolume(page, 36);
    await page.locator('#volume').press('ArrowLeft');
    await expectVolume(page, 35);
    await expect(page.locator('#volume')).toHaveAttribute('aria-valuetext', '35% · 默认');
    const beyond = await sliderPoint(page, 120);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [beyond] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Number(await page.locator('#volume').inputValue())).toBeGreaterThan(110);
    await page.locator('#volume').press('Home');
    await expectVolume(page, 0);
    await page.locator('#volume').press('End');
    await expectVolume(page, 200);
    await page.locator('#stop-all').click();
    expect(await page.evaluate(() => window.__volumeCaptures[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  } finally { await context.close(); }
});
