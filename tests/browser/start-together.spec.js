import { test, expect } from '@playwright/test';

async function observeCapture(page) {
  await page.addInitScript(() => {
    window.__requests = [];
    window.__captures = [];
    window.__pending = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const kind = constraints.video ? 'camera' : 'microphone';
      const hold = window.__hold;
      window.__requests.push(kind);
      if (window.__deny === kind) throw new DOMException('Blocked input', 'NotAllowedError');
      const stream = await capture(constraints);
      window.__captures.push({ kind, tracks: stream.getTracks() });
      if (hold) await new Promise((resolve) => window.__pending.push(resolve));
      return stream;
    };
  });
}

async function expectBothActive(page) {
  await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'active');
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await expect(page.locator('#volume')).toBeEnabled();
}

test('one primary action starts both inputs, respects the reminder, and never leaks a cancelled camera intent', async ({ page }) => {
  await observeCapture(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Start camera & sound', exact: true }).click();
  await expect(page.locator('#playback-confirm')).toHaveText('Start camera & sound');
  expect(await page.evaluate(() => window.__requests)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-all')).toBeFocused();
  expect(await page.evaluate(() => window.__requests)).toEqual([]);

  // Cancelling "both" must not turn a later audio-only confirmation into two captures.
  await page.locator('#empty-listen').click();
  await expect(page.locator('#playback-confirm')).toHaveText('Start listening');
  await page.locator('#playback-confirm').click();
  await expect(page.locator('#audio-scene')).toBeVisible();
  await expect(page.locator('#volume')).toBeEnabled();
  expect(await page.evaluate(() => window.__requests)).toEqual(['microphone']);
  await page.locator('#stop-all').click();

  await page.locator('#start-all').click();
  await expectBothActive(page);
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await expect(page.locator('#camera-button')).toBeFocused();
  expect(await page.evaluate(() => window.__requests)).toEqual(['microphone', 'microphone', 'camera']);
  await page.locator('#camera-button').click();
  await expect(page.locator('#audio-scene')).toBeVisible();
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__captures.every(({ tracks }) => tracks.every((track) => track.readyState === 'ended')))).toBe(true);

  await page.reload();
  await page.locator('#start-all').click();
  await expect(page.locator('#playback-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__requests)).toEqual([]);
  await page.locator('#playback-dont-remind').check();
  await page.locator('#playback-confirm').click();
  await expectBothActive(page);
  await page.reload();
  expect(await page.evaluate(() => window.__requests)).toEqual([]);
  await page.locator('#start-all').click();
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await expectBothActive(page);
  expect(await page.evaluate(() => window.__requests)).toEqual(['microphone', 'camera']);
  await page.locator('#stop-all').click();
});

for (const denied of ['camera', 'microphone']) {
  test(`starting together preserves the other input when ${denied} permission fails`, async ({ page }) => {
    await observeCapture(page);
    await page.goto('./');
    await page.evaluate((kind) => { window.__deny = kind; }, denied);
    await page.locator('#start-all').click();
    await page.locator('#playback-confirm').click();
    if (denied === 'camera') {
      await expect(page.locator('#camera-error')).toContainText('Access was blocked');
      await expect(page.locator('#audio-scene')).toBeVisible();
      await expect(page.locator('#volume')).toBeEnabled();
    } else {
      await expect(page.locator('#mic-error')).toContainText('Access was blocked');
      await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'active');
    }
    expect(await page.evaluate(() => window.__captures.length)).toBe(1);
    await page.evaluate(() => { window.__deny = null; });
    await page.locator(denied === 'camera' ? '#camera-button' : '#microphone-switch').click();
    await expectBothActive(page);
    expect(await page.evaluate(() => window.__captures.length)).toBe(2);
    expect(await page.evaluate(() => window.__captures[0].tracks.every((track) => track.readyState === 'live'))).toBe(true);
    await page.locator('#stop-all').click();
    expect(await page.evaluate(() => window.__captures.every(({ tracks }) => tracks.every((track) => track.readyState === 'ended')))).toBe(true);
  });
}

test('stop all cancels both pending inputs and late permissions cannot replace a newer session', async ({ page }) => {
  await observeCapture(page);
  await page.goto('./');
  await page.evaluate(() => { window.__hold = true; });
  await page.locator('#start-all').click();
  await page.locator('#playback-confirm').click();
  await expect.poll(() => page.evaluate(() => window.__pending.length)).toBe(2);
  await page.locator('#stop-all').click();
  await expect(page.locator('#microphone-switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'idle');
  await page.evaluate(() => { window.__hold = false; });
  await page.locator('#start-all').click();
  await expectBothActive(page);
  await page.evaluate(() => window.__pending.splice(0).forEach((resolve) => resolve()));
  await expect.poll(() => page.evaluate(() => window.__captures.slice(0, 2).every(({ tracks }) => tracks.every((track) => track.readyState === 'ended')))).toBe(true);
  expect(await page.evaluate(() => window.__captures.slice(2).every(({ tracks }) => tracks.every((track) => track.readyState === 'live')))).toBe(true);
  await expectBothActive(page);
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__captures.every(({ tracks }) => tracks.every((track) => track.readyState === 'ended')))).toBe(true);
});
