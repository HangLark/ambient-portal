import { test, expect } from '@playwright/test';
import { toggleListening } from './helpers.js';

// Real Chrome streams with a deterministic device catalog; no physical hardware is opened.
async function installDevices(page) {
  await page.addInitScript(() => {
    window.__sources = { video: ['camera-a', 'camera-b'], audio: ['mic-a', 'mic-b'] };
    window.__authorized = { video: false, audio: false };
    window.__captures = [];
    window.__contexts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) { super(options); window.__contexts.push(this); }
    };
    navigator.mediaDevices.enumerateDevices = async () => Object.entries(window.__sources).flatMap(([kind, ids]) => ids.map((id) => ({
      kind: kind === 'video' ? 'videoinput' : 'audioinput', deviceId: id, groupId: id,
      label: window.__authorized[kind] ? `Studio ${id}` : '',
    })));
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const kind = constraints.video ? 'video' : 'audio';
      const id = constraints[kind].deviceId?.exact || window.__sources[kind][0];
      if (id === window.__rejectSource) throw new DOMException('Device busy', 'NotReadableError');
      if (!window.__sources[kind].includes(id)) throw Object.assign(new DOMException('Missing source', 'OverconstrainedError'), { constraint: 'deviceId' });
      const { deviceId, ...quality } = constraints[kind];
      const stream = await capture({ ...constraints, [kind]: quality });
      const track = stream.getTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: id });
      Object.defineProperty(track, 'label', { value: `Studio ${id}` });
      window.__authorized[kind] = true;
      window.__captures.push({ kind, id, track, constraints });
      return stream;
    };
  });
}

async function expectReachable(page, selector) {
  const locator = page.locator(selector);
  await expect(locator).toBeInViewport({ ratio: 1 });
  expect(await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

test('start is above the fold; desktop, mobile and fullscreen keep the complete control bar reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('./');
  await expectReachable(page, '#start-all');
  await expectReachable(page, '#empty-start');
  for (const selector of ['#camera-button', '#microphone-switch', '#stop-all', '#volume']) await expectReachable(page, selector);
  await page.locator('#empty-start').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.locator('#camera-button')).toBeFocused();
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#fullscreen').click();
  expect(await page.evaluate(() => document.fullscreenElement.id)).toBe('workspace');
  for (const selector of ['#camera-button', '#microphone-switch', '#stop-all', '#volume', '#settings-open']) await expectReachable(page, selector);
  await page.locator('#sound-help').click();
  await expect(page.locator('#sound-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#camera-button').click();
  await expect(page.locator('#audio-scene')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('audio-fullscreen.png') });
  await page.locator('#stop-all').click();
  await expect(page.locator('#empty-start')).toBeVisible();
  await page.locator('#fullscreen').click();
  for (const [width, height] of [[390, 844], [320, 760]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectReachable(page, '#start-all');
    await expectReachable(page, '#empty-start');
    await expectReachable(page, '#empty-listen');
    await toggleListening(page);
    await expect(page.locator('#audio-scene')).toBeVisible();
    for (const selector of ['#camera-button', '#microphone-switch', '#stop-all', '#volume']) await expectReachable(page, selector);
    await page.screenshot({ path: testInfo.outputPath(`audio-${width}.png`), fullPage: true });
    await page.locator('#stop-all').click();
  }
});

test('sound checks distinguish quiet input, signal, zero gain, interruption and suspended playback in both languages', async ({ page }, testInfo) => {
  await installDevices(page);
  await page.addInitScript(() => {
    window.__sample = 128;
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const analyser = createAnalyser.call(this);
      analyser.getByteTimeDomainData = (data) => data.fill(window.__sample);
      return analyser;
    };
  });
  await page.goto('./');
  await toggleListening(page);
  await expect(page.locator('#audio-scene')).toBeVisible();
  await expect(page.locator('#audio-source')).toHaveText('Studio mic-a');
  await expect(page.locator('#scene-caption')).toHaveText('No clear sound detected yet');
  await expect(page.locator('#scene-meter .lit')).toHaveCount(0);
  await page.evaluate(() => { window.__sample = 160; });
  await expect(page.locator('#scene-caption')).toHaveText('Sound detected');
  await page.locator('#volume').focus();
  await page.locator('#volume').press('Home');
  await expect(page.locator('#playback-status')).toHaveText('Page playback muted · 0%');
  await expect(page.locator('#scene-meter .lit')).toHaveCount(40);
  await page.locator('#sound-help').click();
  await expect(page.locator('#check-input')).toHaveText('Sound detected');
  await expect(page.locator('#check-playback')).toHaveText('Page playback muted · 0%');
  await expect(page.locator('#sound-dialog')).toContainText('cannot detect whether remote sound forwarding is working');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-help')).toBeFocused();
  await page.evaluate(() => {
    const track = window.__captures[0].track;
    Object.defineProperty(track, 'muted', { configurable: true, value: true });
    track.dispatchEvent(new Event('mute'));
  });
  await expect(page.locator('#audio-scene-title')).toHaveText('Microphone signal interrupted');
  await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('#scene-meter .lit')).toHaveCount(0);
  await page.evaluate(async () => {
    const track = window.__captures[0].track;
    Object.defineProperty(track, 'muted', { configurable: true, value: false });
    track.dispatchEvent(new Event('unmute'));
    await window.__contexts[0].suspend();
  });
  await expect(page.locator('#resume-audio')).toBeVisible();
  await expect(page.locator('#mic-status')).toHaveText('Input meter paused');
  await page.locator('#language').click();
  await page.locator('#sound-help').click();
  await expect(page.locator('#check-input')).toHaveText('输入电平已暂停');
  await expect(page.locator('#check-playback')).toHaveText('回放已暂停');
  await page.screenshot({ path: testInfo.outputPath('sound-checks-zh-CN.png'), fullPage: true });
  await page.locator('#diagnostic-resume').click();
  await expect(page.locator('#check-playback')).toHaveText('本页回放已静音 · 0%');
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__captures.every(({ track }) => track.readyState === 'ended'))).toBe(true);
});

test('permission-aware input pickers switch only the selected channel and expose missing sources for recovery', async ({ page }, testInfo) => {
  await installDevices(page);
  await page.goto('./');
  await page.locator('#settings-open').click();
  await expect(page.locator('#camera-picker')).toBeHidden();
  await expect(page.locator('#microphone-picker')).toBeHidden();
  expect(await page.evaluate(() => window.__captures.length)).toBe(0);
  await page.keyboard.press('Escape');
  await page.locator('#camera-button').click();
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#settings-open').click();
  await expect(page.locator('#camera-source-name')).toHaveText('Studio camera-a');
  await expect(page.locator('#microphone-source-name')).toHaveText('Studio mic-a');
  await page.locator('#camera-device').selectOption('camera-b');
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.locator('#camera-source-name')).toHaveText('Studio camera-b');
  expect(await page.evaluate(() => window.__captures.map(({ kind, id, track }) => [kind, id, track.readyState]))).toEqual([
    ['video', 'camera-a', 'ended'], ['audio', 'mic-a', 'live'], ['video', 'camera-b', 'live'],
  ]);
  await page.keyboard.press('Escape');
  await page.locator('#volume').press('End');
  await page.locator('#settings-open').click();
  await page.locator('#microphone-device').selectOption('mic-b');
  await expect(page.locator('#microphone-source-name')).toHaveText('Studio mic-b');
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await expect(page.locator('#volume-value')).toHaveText('35%');
  await expect(page.locator('#microphone-source-status')).toContainText('previous gain exceeded 100%');
  expect(await page.evaluate(() => window.__captures[2].track.readyState)).toBe('live');
  expect(await page.evaluate(() => window.__captures[3].constraints.audio.deviceId)).toEqual({ exact: 'mic-b' });
  await page.screenshot({ path: testInfo.outputPath('device-settings.png') });
  await page.evaluate(() => {
    window.__sources.video = ['camera-a'];
    const track = window.__captures[2].track;
    track.stop(); track.dispatchEvent(new Event('ended'));
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await expect(page.locator('#camera-device')).toHaveValue('camera-b');
  await expect(page.locator('#camera-picker')).toBeVisible();
  await expect(page.locator('#camera-device option:checked')).toContainText('Unavailable');
  await page.keyboard.press('Escape');
  await page.locator('#camera-button').click();
  await expect(page.locator('#camera-error')).toContainText('selected device is unavailable');
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#settings-open').click();
  await page.locator('#camera-device').selectOption('camera-a');
  await page.keyboard.press('Escape');
  // Selecting a source after an error prepares it; only an explicit start captures again.
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await page.locator('#stop-all').click();
  await page.reload();
  expect(await page.evaluate(() => window.__captures.length)).toBe(0);
  await page.locator('#settings-open').click();
  await expect(page.locator('#camera-source-name')).toHaveText('Device name appears after starting');
});


test('source failures are visible inside settings without stopping the other input', async ({ page }) => {
  await installDevices(page);
  await page.goto('./');
  await page.locator('#camera-button').click();
  await toggleListening(page);
  await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
  await page.locator('#settings-open').click();
  await page.evaluate(() => { window.__rejectSource = 'camera-b'; });
  await page.locator('#camera-device').selectOption('camera-b');
  await expect(page.locator('#camera-source-status')).toBeVisible();
  await expect(page.locator('#camera-source-status')).toContainText('Close other apps');
  expect(await page.evaluate(() => window.__captures[1].track.readyState)).toBe('live');
  await page.evaluate(() => { window.__rejectSource = null; });
  await page.keyboard.press('Escape');
  await page.locator('#camera-button').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await page.locator('#settings-open').click();
  await expect(page.locator('#camera-source-status')).toBeHidden();
  await page.evaluate(() => { window.__rejectSource = 'mic-b'; });
  await page.locator('#microphone-device').selectOption('mic-b');
  await expect(page.locator('#microphone-source-status')).toBeVisible();
  await expect(page.locator('#microphone-source-status')).toContainText('Close other apps');
  expect(await page.evaluate(() => window.__captures[2].track.readyState)).toBe('live');
  await page.keyboard.press('Escape');
  await page.locator('#language').click();
  await page.locator('#settings-open').click();
  await expect(page.locator('#microphone-source-status')).toContainText('关闭其他正在使用它的应用');
  await page.keyboard.press('Escape');
  await page.locator('#stop-all').click();
  expect(await page.evaluate(() => window.__captures.every(({ track }) => track.readyState === 'ended'))).toBe(true);
});

test('sound checks start listening and restore muted playback without restarting capture in either language', async ({ page }, testInfo) => {
  await installDevices(page);
  await page.addInitScript(() => {
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      window.__diagnosticGain = node;
      return node;
    };
  });
  for (const language of ['en-US', 'zh-CN']) {
    await page.goto('./');
    if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
    await page.locator('#empty-start').click();
    await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'active');
    await page.locator('#sound-help').click();
    await expect(page.locator('#diagnostic-start')).toBeVisible();
    expect(await page.evaluate(() => window.__captures.map(({ kind }) => kind))).toEqual(['video']);
    await page.locator('#diagnostic-start').click();
    await expect(page.locator('#playback-dialog')).toBeVisible();
    await page.locator('#playback-confirm').click();
    await expect(page.locator('#check-playback')).toHaveText(language === 'en-US' ? 'Playing on this device' : '正在此设备回放');
    await expect(page.locator('#diagnostic-start')).toBeHidden();
    await expect(page.locator('#sound-dialog form button')).toBeFocused();
    expect(await page.evaluate(() => window.__captures[0].track.readyState)).toBe('live');
    await page.keyboard.press('Escape');
    await page.locator('#volume').press('Home');
    await page.locator('#camera-button').click();
    await expect(page.locator('#preview-status-text')).toHaveText(language === 'en-US' ? 'Muted' : '回放静音');
    await expect(page.locator('#audio-scene-title')).toHaveText(language === 'en-US' ? 'This page’s playback is muted' : '本页回放已静音');
    await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'paused');
    await page.locator('#sound-help').click();
    await expect(page.locator('#check-playback-help')).toContainText(language === 'en-US' ? 'microphone is still capturing' : '麦克风仍在采集');
    await expect(page.locator('#diagnostic-unmute')).toHaveText(language === 'en-US' ? 'Set volume to 35%' : '恢复到 35%');
    await page.screenshot({ path: testInfo.outputPath(`muted-help-${language}.png`), fullPage: true });
    await page.locator('#diagnostic-unmute').click();
    await expect.poll(() => page.evaluate(() => window.__diagnosticGain.gain.value)).toBeCloseTo(.35, 2);
    await expect(page.locator('#volume-value')).toHaveText('35%');
    await expect(page.locator('#diagnostic-unmute')).toBeHidden();
    await expect(page.locator('#sound-dialog form button')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('.brand').click();
    expect(await page.evaluate(() => window.__captures.length)).toBe(2);
    expect(await page.evaluate(() => window.__captures[1].track.readyState)).toBe('live');
    await page.locator('#stop-all').click();
    expect(await page.evaluate(() => window.__captures.every(({ track }) => track.readyState === 'ended'))).toBe(true);
  }
});

test('audio-only startup shows permission guidance and cancellation releases a late microphone stream', async ({ page }, testInfo) => {
  await installDevices(page);
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await new Promise((resolve) => { window.__allowMicrophone = resolve; });
      return capture(constraints);
    };
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('./');
  await toggleListening(page);
  for (const language of ['en-US', 'zh-CN']) {
    if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#language').click();
    await expect(page.locator('#audio-scene')).toBeVisible();
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('#scene-meter')).toBeHidden();
    await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'requesting');
    await expect(page.locator('#scene-caption')).toContainText(language === 'en-US' ? 'allow microphone access' : '允许访问麦克风');
    await expectReachable(page, '#microphone-switch');
    await page.screenshot({ path: testInfo.outputPath(`microphone-pending-${language}.png`), fullPage: true });
  }
  await toggleListening(page);
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.evaluate(() => window.__allowMicrophone());
  await expect.poll(() => page.evaluate(() => window.__captures.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__captures[0].track.readyState)).toBe('ended');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => window.__contexts[0].state)).toBe('closed');
});
