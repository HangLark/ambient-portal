import { test, expect } from '@playwright/test';

test('playback warning precedes microphone permission, can be cancelled, and lasts only for this page', async ({ page }) => {
  await page.addInitScript(() => {
    window.__microphoneRequests = 0;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints.audio) window.__microphoneRequests++;
      return capture(constraints);
    };
  });
  await page.goto('./');
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
  await expect(page.locator('#microphone-switch')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#microphone-switch')).toBeFocused();
  expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
  await page.locator('#microphone-switch').click();
  await page.locator('#playback-cancel').click();
  expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
  await page.locator('#microphone-switch').click();
  await page.locator('#playback-confirm').click();
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
  expect(await page.evaluate(() => window.__microphoneRequests)).toBe(1);
  await page.locator('#microphone-switch').click();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await page.reload();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-dialog')).toBeVisible();
  expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
});

test('one-click mute keeps capture live, restores its gain, and reopening protects against the old boost', async ({ page }) => {
  await page.addInitScript(() => {
    window.__playbackTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__playbackTracks.push(...stream.getTracks());
      return stream;
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      window.__playbackGain = node;
      return node;
    };
  });
  await page.goto('./');
  await expect(page.locator('#mute-playback')).toBeDisabled();
  await page.locator('#camera-button').click();
  await page.locator('#microphone-switch').click();
  await page.locator('#playback-confirm').click();
  await expect(page.locator('#volume')).toBeEnabled();
  await page.locator('#volume').press('End');
  await page.locator('#mute-playback').click();
  await expect(page.locator('#volume-value')).toHaveText('0%');
  expect(await page.evaluate(() => window.__playbackGain.gain.value)).toBe(0);
  await expect(page.locator('#playback-muted-help')).toContainText('microphone is still capturing');
  await expect(page.locator('#mute-playback')).toHaveAccessibleName('Unmute this page’s playback · 200%');
  expect(await page.evaluate(() => window.__playbackTracks.length)).toBe(2);
  expect(await page.evaluate(() => window.__playbackTracks.every((track) => track.readyState === 'live'))).toBe(true);
  await page.locator('#mute-playback').press('Enter');
  await expect(page.locator('#volume-value')).toHaveText('200%');
  await expect.poll(() => page.evaluate(() => window.__playbackGain.gain.value)).toBeCloseTo(2, 2);
  await page.locator('#microphone-switch').click();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#volume-value')).toHaveText('35%');
  await expect(page.locator('#volume-reset-hint')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__playbackGain.gain.value)).toBeCloseTo(.35, 2);
  await page.locator('#volume').press('End');
  await expect(page.locator('#volume-reset-hint')).toBeHidden();
  await page.locator('#mute-playback').click();
  await page.locator('#microphone-switch').click();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#volume')).toBeEnabled();
  await expect(page.locator('#volume-value')).toHaveText('0%');
  await expect(page.locator('#mute-playback')).toHaveAccessibleName('Unmute this page’s playback · 35%');
  await page.locator('#mute-playback').click();
  await expect(page.locator('#volume-value')).toHaveText('35%');
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__playbackTracks.every((track) => track.readyState === 'ended'))).toBe(true);
});

test('the sound-check shortcut requires confirmation and returns focus correctly in both languages', async ({ page }) => {
  for (const language of ['en-US', 'zh-CN']) {
    await page.goto('./');
    if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
    await page.locator('#sound-help').click();
    await page.locator('#diagnostic-start').click();
    await expect(page.locator('#playback-dialog')).toBeVisible();
    await expect(page.locator('#playback-cancel')).toBeFocused();
    await expect(page.locator('#playback-warning')).toContainText(language === 'en-US' ? 'remote audio forwarding' : '远程声音转发');
    await expect(page.locator('#microphone-switch')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('#sound-dialog')).toBeVisible();
    await expect(page.locator('#diagnostic-start')).toBeFocused();
    await page.locator('#diagnostic-start').press('Enter');
    await page.locator('#playback-confirm').press('Enter');
    await expect(page.locator('#check-playback')).toHaveText(language === 'en-US' ? 'Page playback is on' : '本页回放已开启');
    await expect(page.locator('#sound-dialog form button')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('#mute-playback').click();
    await expect(page.locator('#mute-playback')).toHaveAccessibleName(language === 'en-US' ? 'Unmute this page’s playback · 35%' : '取消本页静音 · 35%');
    await expect(page.locator('#playback-muted-help')).toContainText(language === 'en-US' ? 'Remote forwarding' : '远程转发');
    await page.locator('#stop-all').click();
  }
});

test('the reminder fits both palettes and languages on desktop, narrow phones and fullscreen', async ({ page }, testInfo) => {
  await page.goto('./');
  for (const theme of ['dark', 'light']) {
    await page.locator('#theme-button').click();
    await page.locator(`input[name="theme"][value="${theme}"]`).check();
    await page.keyboard.press('Escape');
    for (const [width, height] of [[1366, 768], [320, 760]]) {
      await page.setViewportSize({ width, height });
      for (const language of ['en-US', 'zh-CN']) {
        if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
        await page.locator('#microphone-switch').click();
        await expect(page.locator('#playback-dialog')).toBeVisible();
        await expect(page.locator('#playback-confirm')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#playback-warning')).toBeInViewport({ ratio: 1 });
        expect(await page.locator('#playback-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`reminder-${theme}-${width}-${language}.png`), fullPage: true });
        await page.locator('#playback-cancel').click();
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'active');
  await page.locator('#fullscreen').click();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-dialog')).toBeVisible();
  await expect(page.locator('#playback-confirm')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('reminder-fullscreen.png') });
  await page.locator('#playback-cancel').click();
  expect(await page.locator('video').evaluate((video) => video.srcObject.getVideoTracks()[0].readyState)).toBe('live');
  await page.locator('#stop-all').click();
});

test('denied microphone permission can be retried after confirmation without a second reminder', async ({ page }) => {
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let denied = false;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints.audio && !denied) {
        denied = true;
        return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      }
      return capture(constraints);
    };
  });
  await page.goto('./');
  await page.locator('#microphone-switch').click();
  await page.locator('#playback-confirm').click();
  await expect(page.locator('#mic-error')).toContainText('Access was blocked');
  await expect(page.locator('#microphone-switch')).toBeFocused();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
  await page.locator('#stop-all').click();
});
