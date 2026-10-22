import { test, expect } from '@playwright/test';

async function chooseTheme(page, value) {
  if (!(await page.locator('#theme-control').evaluate((element) => element.open))) await page.locator('#theme-button').click();
  await page.locator(`input[name="theme"][value="${value}"]`).check();
  await page.keyboard.press('Escape');
}

async function expectTheme(page, theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).colorScheme)).toBe(theme);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme === 'light' ? '#f7f7f9' : '#101113');
}

test('appearance follows system changes until overridden, persists on reload, and can return to system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await expectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light');
  await chooseTheme(page, 'dark');
  await expectTheme(page, 'dark');
  await expect(page.locator('#theme-button')).toBeFocused();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark');
  await page.reload();
  await expectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();
  await page.locator('#theme-button').focus();
  await page.keyboard.press('Enter');
  await page.locator('input[name="theme"][value="dark"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expectTheme(page, 'light');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.locator('#theme-button').click();
  await page.locator('#heading').click();
  await expect(page.locator('#theme-control')).not.toHaveAttribute('open');
});

test('saved light appearance is painted even before the application bundle arrives', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('ambient-portal.theme', 'light'));
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('./');
  await expectTheme(page, 'light');
  await expect(page.locator('#app')).toBeEmpty();
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(247, 247, 249)');
  await page.unroute('**/assets/*.js');
  await page.reload();
  await expect(page.locator('#theme-button')).toHaveAccessibleName('Appearance: Light');
});

test('blocked storage keeps switching usable for the session and invalid preferences fall back to system', async ({ browser, baseURL }) => {
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ colorScheme: 'dark', locale: 'en-US' });
    await context.addInitScript((block) => {
      if (block) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
      else localStorage.setItem('ambient-portal.theme', 'invalid');
    }, blocked);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
    await expectTheme(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
    await chooseTheme(page, 'light');
    await expectTheme(page, 'light');
    await page.locator('#language').click();
    await expect(page.locator('#theme-button')).toHaveAccessibleName('外观: 浅色');
    expect(errors).toEqual([]);
    await context.close();
  }
});

test('theme changes preserve active media, gain and camera format; fullscreen uses the selected palette', async ({ page }) => {
  await page.addInitScript(() => {
    window.__themeCaptures = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__themeCaptures.push(stream);
      return stream;
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      window.__themeGain = gain;
      return gain;
    };
  });
  await page.goto('./');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await page.getByRole('switch').click();
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#volume').focus();
  await page.keyboard.press('End');
  await page.locator('#settings-open').click();
  await page.locator('#camera-format').selectOption('16:9');
  await expect(page.locator('#camera-format')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Escape');
  const before = await page.locator('video').evaluate((video) => video.srcObject.getVideoTracks()[0].getSettings());
  for (const theme of ['dark', 'light']) {
    await chooseTheme(page, theme);
    await expectTheme(page, theme);
    expect(await page.evaluate(() => window.__themeCaptures.length)).toBe(2);
    expect(await page.evaluate(() => window.__themeCaptures.every((stream) => stream.getTracks().every((track) => track.readyState === 'live')))).toBe(true);
    expect(await page.locator('video').evaluate((video) => video.srcObject === window.__themeCaptures[0])).toBe(true);
    expect(await page.locator('video').evaluate((video) => video.srcObject.getVideoTracks()[0].getSettings())).toEqual(before);
    expect(await page.evaluate(() => window.__themeGain.context.state)).toBe('running');
    await expect.poll(() => page.evaluate(() => window.__themeGain.gain.value)).toBeCloseTo(2, 2);
    await expect(page.locator('#volume-value')).toHaveText('200%');
    await page.locator('#fullscreen').click();
    expect(await page.evaluate(() => document.fullscreenElement.id)).toBe('workspace');
    expect(await page.locator('#workspace').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 22, 25)');
    expect(await page.locator('video').evaluate((video) => getComputedStyle(video).filter)).toBe('none');
    expect(await page.locator('video').evaluate((video) => getComputedStyle(video).backgroundColor)).toBe('rgb(9, 10, 11)');
    await page.locator('#fullscreen').click();
  }
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__themeCaptures.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
});

test('both palettes fit desktop and phone layouts, translated pickers, audio-only views and dialogs', async ({ page }, testInfo) => {
  await page.goto('./');
  for (const theme of ['dark', 'light']) {
    await chooseTheme(page, theme);
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['narrow', 320, 760]]) {
      await page.setViewportSize({ width, height });
      for (const language of ['en-US', 'zh-CN']) {
        if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.locator('#theme-button')).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${name}-${language}.png`), fullPage: true });
        await page.locator('#theme-button').click();
        await expect(page.locator('input[name="theme"][value="system"]')).toBeVisible();
        expect(await page.locator('.theme-options').evaluate((element) => element.getBoundingClientRect().left >= 0)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${theme}-picker-${name}-${language}.png`), fullPage: true });
        await page.keyboard.press('Escape');
      }
    }
    await page.getByRole('switch').click();
    await expect(page.locator('#audio-scene')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${theme}-audio-zh-CN.png`), fullPage: true });
    for (const [button, dialog] of [['settings-open', 'settings-dialog'], ['sound-help', 'sound-dialog']]) {
      await page.locator(`#${button}`).click();
      await expect(page.locator(`#${dialog}`)).toBeVisible();
      expect(await page.locator(`#${dialog}`).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 31)');
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${dialog}-zh-CN.png`), fullPage: true });
      await page.keyboard.press('Escape');
    }
    await page.locator('#stop-all').click();
  }
});
