import { test, expect } from '@playwright/test';

test('the default reminder precedes microphone permission and discards unchecked or cancelled choices', async ({ page }) => {
  await page.addInitScript(() => {
    window.__microphoneRequests = 0;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints.audio) window.__microphoneRequests++;
      return capture(constraints);
    };
  });
  await page.goto('./');
  for (const dismiss of ['escape', 'cancel', 'backdrop']) {
    await page.locator('#microphone-switch').click();
    await expect(page.locator('#playback-dialog')).toBeVisible();
    expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
    await expect(page.locator('#microphone-switch')).toHaveAttribute('aria-checked', 'false');
    const choice = page.getByRole('checkbox', { name: 'Don’t remind me in this browser' });
    await expect(choice).not.toBeChecked();
    await choice.focus();
    await choice.press('Space');
    await expect(choice).toBeChecked();
    if (dismiss === 'escape') await page.keyboard.press('Escape');
    else if (dismiss === 'cancel') await page.locator('#playback-cancel').click();
    else await page.mouse.click(1, 1);
    await expect(page.locator('#playback-dialog')).toBeHidden();
    await expect(page.locator('#microphone-switch')).toBeFocused();
    expect(await page.evaluate(() => window.__microphoneRequests)).toBe(0);
  }
  await page.reload();
  await page.locator('#microphone-switch').click();
  await expect(page.getByRole('checkbox', { name: 'Don’t remind me in this browser' })).not.toBeChecked();
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

test('the reminder can be skipped across reloads and restored without interrupting listening', async ({ page }) => {
  await page.goto('./');
  await page.locator('#microphone-switch').click();
  const skipReminder = page.getByRole('checkbox', { name: 'Don’t remind me in this browser' });
  await expect(skipReminder).not.toBeChecked();
  await skipReminder.check();
  await page.locator('#playback-confirm').click();
  await expect(page.locator('#playback-status')).toHaveText('Page playback is on');

  await page.reload();
  await expect(page.locator('#microphone-switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await page.locator('#sound-help').click();
  await page.locator('#diagnostic-start').click();
  await expect(page.locator('#check-playback')).toHaveText('Page playback is on');
  await expect(page.locator('#sound-dialog form button')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
  await expect(page.locator('#playback-dialog')).toBeHidden();
  await page.locator('#volume').press('End');

  await page.locator('#settings-open').click();
  const reminder = page.getByRole('switch', { name: 'Remind me before listening', exact: true });
  await expect(reminder).toHaveAttribute('aria-checked', 'false');
  await reminder.focus();
  await reminder.press('Space');
  await expect(reminder).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
  await expect(page.locator('#volume-value')).toHaveText('200%');
  await page.locator('#microphone-switch').click();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-dialog')).toBeVisible();
  await expect(skipReminder).not.toBeChecked();
  await page.locator('#playback-cancel').click();

  await page.reload();
  await page.locator('#microphone-switch').click();
  await expect(page.locator('#playback-dialog')).toBeVisible();
});

test('blocked storage explains that the reminder choice only applies to the current page', async ({ browser, baseURL }) => {
  for (const failure of ['access', 'read', 'write']) {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript((mode) => {
      if (mode === 'access') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
      else {
        if (mode === 'read') Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
        Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
      }
    }, failure);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.locator('#microphone-switch').click();
    await page.getByRole('checkbox', { name: 'Don’t remind me in this browser' }).check();
    await page.locator('#playback-confirm').click();
    await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
    await expect(page.locator('#playback-preference-notice')).toContainText('Couldn’t save this setting');
    await page.locator('#microphone-switch').click();
    await page.locator('#microphone-switch').click();
    await expect(page.locator('#playback-status')).toHaveText('Page playback is on');
    await expect(page.locator('#playback-dialog')).toBeHidden();
    await page.reload();
    await page.locator('#microphone-switch').click();
    await expect(page.locator('#playback-dialog')).toBeVisible();
    await page.locator('#playback-cancel').click();
    await page.locator('#sound-help').click();
    await page.locator('#diagnostic-start').click();
    await page.getByRole('checkbox', { name: 'Don’t remind me in this browser' }).check();
    await page.locator('#playback-confirm').click();
    await expect(page.locator('#check-playback')).toHaveText('Page playback is on');
    await expect(page.locator('#sound-playback-preference-notice')).toBeVisible();
    await expect(page.locator('#sound-playback-preference-notice')).toContainText('Couldn’t save this setting');
    await page.keyboard.press('Escape');
    await page.locator('#settings-open').click();
    await page.getByRole('switch', { name: 'Remind me before listening', exact: true }).click();
    await expect(page.locator('#playback-reminder-notice')).toContainText('Couldn’t save this setting');
    expect(errors).toEqual([]);
    await context.close();
  }
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
        await expect(page.locator('#playback-dont-remind')).not.toBeChecked();
        await expect(page.locator('#playback-dont-remind-help')).toBeInViewport({ ratio: 1 });
        await page.locator('#playback-dont-remind').check();
        await expect(page.locator('#playback-confirm')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#playback-warning')).toBeInViewport({ ratio: 1 });
        expect(await page.locator('#playback-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`reminder-${theme}-${width}-${language}.png`), fullPage: true });
        await page.locator('#playback-cancel').click();
        await page.locator('#settings-open').click();
        await expect(page.locator('#playback-reminder')).toHaveAccessibleName(language === 'en-US' ? 'Remind me before listening' : '开启监听前提醒');
        await expect(page.locator('#playback-reminder')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#playback-reminder')).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath(`reminder-setting-${theme}-${width}-${language}.png`), fullPage: true });
        await page.keyboard.press('Escape');
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
