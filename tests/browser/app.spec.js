import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__testTracks = [];
    if (!navigator.mediaDevices) return;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      window.__testTracks.push(...stream.getTracks());
      return stream;
    };
  });
});

test('production assets load under the Pages subpath, with no external requests', async ({ page }) => {
  const errors = [], requests = [], failures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => { if (response.status() >= 400) failures.push(response.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your surroundings, within reach.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop everything' })).toBeDisabled();
  await expect(page.locator('#empty-state')).toBeVisible();
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();
  expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173/ambient-portal/'))).toBe(true);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
});

test('camera and microphone operate independently and stop releases every track', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect.poll(() => page.locator('video').evaluate((video) => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.locator('#microphone-status')).toHaveText('Off');
  await page.getByRole('switch').click();
  await expect(page.locator('#mic-status')).toHaveText('On');
  await expect(page.locator('#volume')).toBeEnabled();
  await page.locator('#volume').focus();
  await page.locator('#volume').press('ArrowRight');
  await expect(page.locator('#volume-value')).toHaveText('36%');
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.locator('#microphone-status')).toHaveText('On');
  await expect(page.locator('#preview-status-text')).toHaveText('Standby');
  await page.getByRole('button', { name: 'Stop everything' }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => window.__testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();
});

test('microphone can start before the camera and pagehide releases it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('switch').click();
  await expect(page.locator('#mic-status')).toHaveText('On');
  await expect(page.locator('#camera-status')).toHaveText('Off');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.locator('#mic-status')).toHaveText('Off');
  expect(await page.evaluate(() => window.__testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
});

test('a rejected permission has translated guidance and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let rejected = false;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (!rejected) { rejected = true; return Promise.reject(new DOMException('Denied', 'NotAllowedError')); }
      return original(constraints);
    };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('#empty-body')).toContainText('Access was blocked');
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await expect(page.locator('#empty-body')).toContainText('设备访问被阻止');
  await page.getByRole('button', { name: '重试摄像头' }).click();
  await expect(page.locator('#preview-status-text')).toHaveText('实时');
  await page.getByRole('button', { name: '停止全部采集' }).click();
});

test('missing microphone reports the problem without disrupting camera preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => constraints.audio
      ? Promise.reject(new DOMException('Missing', 'NotFoundError')) : original(constraints);
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await page.getByRole('switch').click();
  await expect(page.locator('#mic-error')).toContainText('No microphone was found');
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Stop everything' }).click();
});

test('a pending camera request can be cancelled from the UI', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop everything' }).click();
  await expect(page.locator('#preview-status-text')).toHaveText('Standby');
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeEnabled();
});

test('language persists after reload without reactivating capture', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('button', { name: '开启摄像头' }).click();
  await expect(page.locator('#preview-status-text')).toHaveText('实时');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '开启摄像头' })).toBeVisible();
  expect(await page.evaluate(() => window.__testTracks.length)).toBe(0);
});

test('Chinese browser language is selected automatically', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/ambient-portal/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: '开启摄像头' })).toBeVisible();
  await context.close();
});

test('unavailable media API disables capture with an actionable explanation', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined }));
  await page.goto('./');
  await expect(page.locator('#environment-error')).toContainText('latest Chrome or Edge');
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeDisabled();
  await expect(page.getByRole('switch')).toBeDisabled();
});

test('keyboard-operable remote guide returns focus when dismissed', async ({ page }) => {
  await page.goto('./');
  const guide = page.getByRole('button', { name: 'Using a remote desktop?' });
  await guide.focus();
  await guide.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(guide).toBeFocused();
});

test('desktop and mobile layouts fit their viewport in both languages', async ({ page }, testInfo) => {
  await page.goto('./');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['narrow', 320, 760]]) {
    await page.setViewportSize({ width, height });
    for (const language of ['en-US', 'zh-CN']) {
      if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('#camera-button')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${name}-${language}.png`), fullPage: true });
    }
  }
});
