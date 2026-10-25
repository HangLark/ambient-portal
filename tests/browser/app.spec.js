import { test, expect } from '@playwright/test';
import { toggleListening } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__testTracks = [];
    window.__testGains = [];
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      window.__testGains.push(node);
      return node;
    };
    if (!navigator.mediaDevices) return;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      window.__testTracks.push(...stream.getTracks());
      return stream;
    };
  });
});

test('production assets load under the Pages subpath, with no external requests', async ({ page, baseURL }) => {
  const errors = [], requests = [], failures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => { if (response.status() >= 400) failures.push(response.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Camera & ambient sound' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop all' })).toBeDisabled();
  await expect(page.locator('#empty-state')).toBeVisible();
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  expect(requests.every((url) => url.startsWith(baseURL))).toBe(true);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  await page.reload();
  await expect(page.locator('#camera-button')).toBeVisible();
});

test('camera and microphone operate independently and stop releases every track', async ({ page }) => {
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect.poll(() => page.locator('video').evaluate((video) => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.locator('#mic-status')).toHaveText('Microphone off');
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await expect(page.locator('#volume')).toBeEnabled();
  await page.locator('#volume').focus();
  await page.locator('#volume').press('ArrowRight');
  await expect(page.locator('#volume-value')).toHaveText('36%');
  await page.locator('#volume').press('End');
  await expect(page.locator('#volume-value')).toHaveText('200%');
  await expect.poll(() => page.evaluate(() => window.__testGains[0].gain.value)).toBeCloseTo(2, 2);
  expect(await page.locator('#volume-track').evaluate((track) => track.style.getPropertyValue('--volume'))).toBe('100%');
  await expect(page.locator('#volume-boost-hint')).toBeVisible();
  await page.locator('#volume').press('Home');
  await expect(page.locator('#volume-value')).toHaveText('0%');
  await expect(page.locator('#volume-boost-hint')).toBeHidden();
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.locator('#playback-status')).toHaveText('Page playback muted · 0%');
  await expect(page.locator('#preview-status-text')).toHaveText('Muted');
  await page.getByRole('button', { name: 'Stop all' }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => window.__testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();
});

test('capture prefers the highest device specifications and displays the actual negotiated settings', async ({ page }) => {
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  const tracks = await page.evaluate(() => window.__testTracks.map((track) => ({
    kind: track.kind, capabilities: track.getCapabilities(), constraints: track.getConstraints(), settings: track.getSettings(),
  })));
  const camera = tracks.find((track) => track.kind === 'video');
  const microphone = tracks.find((track) => track.kind === 'audio');
  expect(camera.settings.width).toBe(camera.capabilities.width.max);
  expect(camera.settings.height).toBe(camera.capabilities.height.max);
  expect(camera.settings.frameRate).toBe(camera.capabilities.frameRate.max);
  expect(camera.settings.resizeMode).toBe('none');
  await expect(page.locator('#preview-detail')).toContainText(`${camera.settings.width} × ${camera.settings.height}`);
  await expect(page.locator('#preview-detail')).toContainText(`${Math.round(camera.settings.frameRate * 10) / 10} fps`);
  for (const property of ['sampleRate', 'sampleSize', 'channelCount']) {
    if (!microphone.capabilities[property]) continue;
    const preference = microphone.constraints[property];
    expect(preference.ideal ?? preference).toBe(microphone.capabilities[property].max);
    // Chromium's unprocessed synthetic input can stay at 44.1 kHz even when its range includes 48 kHz.
    // Capabilities are not a list of jointly supported modes; the UI must report the actual result.
    expect(microphone.settings[property]).toBeGreaterThanOrEqual(microphone.capabilities[property].min);
    expect(microphone.settings[property]).toBeLessThanOrEqual(microphone.capabilities[property].max);
  }
  for (const property of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
    expect(microphone.settings[property]).toBe(false);
  }
  await expect(page.locator('#audio-detail')).toContainText(`${microphone.settings.sampleRate / 1000} kHz`);
  await expect(page.locator('#audio-detail')).toContainText(`${microphone.settings.channelCount} ch`);
  await page.getByRole('button', { name: 'Stop all' }).click();
});

test('active audio specifications and amplified volume fit both languages on desktop and mobile', async ({ page }, testInfo) => {
  await page.goto('./');
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#volume').focus();
  await page.locator('#volume').press('End');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['narrow', 320, 760]]) {
    await page.setViewportSize({ width, height });
    for (const language of ['en-US', 'zh-CN']) {
      if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
      await expect(page.locator('#volume-value')).toHaveText('200%');
      await expect(page.locator('#volume-boost-hint')).toContainText(language === 'en-US' ? 'Above 100%' : '超过 100%');
      await expect(page.locator('#audio-scene')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`boost-${name}-${language}.png`), fullPage: true });
    }
  }
  await page.locator('#stop-all').click();
  await expect(page.locator('#audio-detail')).toBeHidden();
  await expect(page.locator('#volume-boost-hint')).toBeHidden();
});

test('microphone can start before the camera and pagehide releases it', async ({ page }) => {
  await page.goto('./');
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await expect(page.locator('#camera-button')).toHaveText('Start camera');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.locator('#mic-status')).toHaveText('Microphone off');
  expect(await page.evaluate(() => window.__testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
});

test('a rejected permission has translated guidance and can be retried', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let rejected = false;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (!rejected) { rejected = true; return Promise.reject(new DOMException('Denied', 'NotAllowedError')); }
      return original(constraints);
    };
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.locator('#empty-body')).toContainText('Access was blocked');
  await expect(page.locator('#empty-start')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('permission-en-US.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await expect(page.locator('#empty-body')).toContainText('访问被阻止');
  await expect(page.locator('#empty-start')).toHaveText('重新开启摄像头');
  await expect(page.locator('#empty-hint')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('permission-zh-CN.png'), fullPage: true });
  await page.locator('#empty-start').click();
  await expect(page.locator('#preview-status-text')).toHaveText('实时');
  await page.getByRole('button', { name: '全部停止' }).click();
});

test('missing microphone reports the problem without disrupting camera preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => constraints.audio
      ? Promise.reject(new DOMException('Missing', 'NotFoundError')) : original(constraints);
  });
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await toggleListening(page);
  await expect(page.locator('#mic-error')).toContainText('No microphone was found');
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Stop all' }).click();
});

test('a pending camera request can be cancelled from the UI', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  });
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.getByRole('button', { name: 'Cancel start' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop all' }).click();
  await expect(page.locator('#preview-status-text')).toHaveText('Camera off');
  await expect(page.locator('#camera-button')).toBeEnabled();
});

test('language persists after reload without reactivating capture', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.brand')).toHaveText('Ambient Portal');
  await page.getByRole('button', { name: 'Switch to Simplified Chinese' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.brand')).toHaveText('遥·窗');
  await expect(page.locator('.brand')).toHaveAccessibleName('遥·窗');
  await expect(page).toHaveTitle('遥·窗 — 实时画面与环境声音');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^遥·窗/);
  await page.locator('#guide-open').click();
  await expect(page.locator('#guide-intro')).toContainText('遥·窗');
  await expect(page.locator('[data-i18n="guidePrivacy"]')).toContainText('遥·窗');
  await page.keyboard.press('Escape');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('实时');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.brand')).toHaveText('遥·窗');
  await expect(page).toHaveTitle('遥·窗 — 实时画面与环境声音');
  await expect(page.locator('#camera-button')).toHaveText('开启摄像头');
  expect(await page.evaluate(() => window.__testTracks.length)).toBe(0);
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.locator('.brand')).toHaveText('Ambient Portal');
  await expect(page.locator('.brand')).toHaveAccessibleName('Ambient Portal');
  await expect(page).toHaveTitle('Ambient Portal — Live camera and ambient sound');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Ambient Portal/);
  await page.locator('#guide-open').click();
  await expect(page.locator('#guide-intro')).toContainText('Ambient Portal');
});

test('Chinese browser language is selected automatically', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  await page.goto(baseURL);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.brand')).toHaveText('遥·窗');
  await expect(page).toHaveTitle('遥·窗 — 实时画面与环境声音');
  await expect(page.locator('#empty-start')).toHaveText('开启摄像头');
  await context.close();
});

test('unavailable media API disables capture with an actionable explanation', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined }));
  await page.goto('./');
  await expect(page.locator('#environment-error')).toContainText('latest Chrome or Edge');
  await expect(page.locator('#camera-button')).toBeDisabled();
  await expect(page.getByRole('switch')).toBeDisabled();
});

test('keyboard-operable remote guide returns focus when dismissed', async ({ page }) => {
  await page.goto('./');
  const guide = page.getByRole('button', { name: 'Remote setup' });
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
