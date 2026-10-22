import { test, expect } from '@playwright/test';

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
  await expectReachable(page, '#empty-start');
  for (const selector of ['#camera-button', '#microphone-switch', '#stop-all', '#volume']) await expectReachable(page, selector);
  await page.locator('#empty-start').click();
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.locator('#camera-button')).toBeFocused();
  await page.getByRole('switch').click();
  await expect(page.locator('#playback-status')).toHaveText('Browser playback running');
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
    await expectReachable(page, '#empty-start');
    await page.getByRole('switch').click();
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
  await page.getByRole('switch').click();
  await expect(page.locator('#audio-scene')).toBeVisible();
  await expect(page.locator('#audio-source')).toHaveText('Studio mic-a');
  await expect(page.locator('#scene-caption')).toContainText('Quiet');
  await expect(page.locator('#scene-meter .lit')).toHaveCount(0);
  await page.evaluate(() => { window.__sample = 160; });
  await expect(page.locator('#scene-caption')).toHaveText('Input signal detected');
  await page.locator('#volume').focus();
  await page.locator('#volume').press('Home');
  await expect(page.locator('#playback-status')).toHaveText('Playback muted · 0%');
  await expect(page.locator('#scene-meter .lit')).toHaveCount(40);
  await page.locator('#sound-help').click();
  await expect(page.locator('#check-input')).toHaveText('Input signal detected');
  await expect(page.locator('#check-playback')).toHaveText('Playback muted · 0%');
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
  await expect(page.locator('#check-input')).toHaveText('输入电平暂不可测');
  await expect(page.locator('#check-playback')).toHaveText('回放已暂停');
  await page.screenshot({ path: testInfo.outputPath('sound-checks-zh-CN.png'), fullPage: true });
  await page.locator('#diagnostic-resume').click();
  await expect(page.locator('#check-playback')).toHaveText('回放已静音 · 0%');
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
  await page.getByRole('switch').click();
  await expect(page.locator('#playback-status')).toHaveText('Browser playback running');
  await page.locator('#settings-open').click();
  await expect(page.locator('#camera-source-name')).toHaveText('Studio camera-a');
  await expect(page.locator('#microphone-source-name')).toHaveText('Studio mic-a');
  await page.locator('#camera-device').selectOption('camera-b');
  await expect(page.locator('#preview-status-text')).toHaveText('Live');
  await expect(page.locator('#camera-source-name')).toHaveText('Studio camera-b');
  expect(await page.evaluate(() => window.__captures.map(({ kind, id, track }) => [kind, id, track.readyState]))).toEqual([
    ['video', 'camera-a', 'ended'], ['audio', 'mic-a', 'live'], ['video', 'camera-b', 'live'],
  ]);
  await page.locator('#microphone-device').selectOption('mic-b');
  await expect(page.locator('#microphone-source-name')).toHaveText('Studio mic-b');
  await expect(page.locator('#playback-status')).toHaveText('Browser playback running');
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
  await expect(page.locator('#playback-status')).toHaveText('Browser playback running');
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
  await expect(page.locator('#camera-source-name')).toHaveText('System default');
});
