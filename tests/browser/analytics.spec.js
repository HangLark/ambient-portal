import { test, expect } from '@playwright/test';

const site = 'https://hanglark.github.io/ambient-portal/';
const beacon = 'https://static.cloudflareinsights.com/beacon.min.js';

// Exercise the production hostname using the tested build, without reporting fake visits.
async function mirrorBuild(page, baseURL, target) {
  await page.route(`${new URL(target).origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const asset = path.startsWith('/ambient-portal/') ? path.slice('/ambient-portal/'.length) : '';
    const response = await page.request.get(new URL(asset || 'index.html', baseURL).href);
    await route.fulfill({ response });
  });
}

test('the official site loads one asynchronous beacon without adding interface copy', async ({ page, baseURL }) => {
  await mirrorBuild(page, baseURL, site);
  let loads = 0;
  await page.route(beacon, async (route) => {
    loads++;
    await route.fulfill({
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: 'window.__beaconLoaded = true;',
    });
  });
  await page.goto(site);
  await expect.poll(() => page.evaluate(() => window.__beaconLoaded)).toBe(true);
  const script = page.locator('script[data-cf-beacon]');
  await expect(script).toHaveCount(1);
  expect(await script.evaluate((element) => ({
    type: element.type, async: element.async, config: JSON.parse(element.dataset.cfBeacon),
  }))).toEqual({ type: 'module', async: true, config: { token: '104e9d106edc48f2b5a317090a23edfc' } });
  expect(await page.locator('video').evaluate((video) => video.srcObject)).toBeNull();

  for (const language of ['en-US', 'zh-CN']) {
    if (language === 'zh-CN') await page.locator('#language').click();
    await expect(page.locator('.privacy-row')).not.toContainText(/Cloudflare/);
    await page.locator('#guide-open').click();
    await expect(page.locator('#guide-dialog')).toBeVisible();
    await expect(page.locator('#guide-dialog')).not.toContainText(/Cloudflare/);
    await page.keyboard.press('Escape');
    for (const colorScheme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('#start-all')).toBeInViewport();
    }
  }
  expect(loads).toBe(1);
  await page.reload();
  await expect.poll(() => loads).toBe(2);
  await expect(script).toHaveCount(1);
});

test('a slow or blocked analytics script never delays capture or breaks its controls', async ({ page, baseURL }) => {
  await mirrorBuild(page, baseURL, site);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route(beacon, async (route) => { await pending; await route.abort('blockedbyclient'); });
  await page.addInitScript(() => {
    window.__analyticsTestTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__analyticsTestTracks.push(...stream.getTracks());
      return stream;
    };
  });
  try {
    const requested = page.waitForRequest(beacon);
    await page.goto(site, { waitUntil: 'domcontentloaded' });
    await requested;
    await page.locator('#start-all').click();
    await page.locator('#playback-confirm').click();
    await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'active');
    await expect(page.locator('#playback-status')).toHaveText('Playing on this device');
    release();
    await page.waitForLoadState('load');
    await page.locator('#language').click();
    await expect(page.locator('#playback-status')).toHaveText('正在此设备回放');
    await expect(page.locator('#preview-status')).toHaveAttribute('data-state', 'active');
    await page.locator('#stop-all').click();
    expect(await page.evaluate(() => window.__analyticsTestTracks.length)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => window.__analyticsTestTracks.every((track) => track.readyState === 'ended'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { release(); }
});

test('local previews, forks and other projects do not load the official analytics', async ({ page, baseURL }) => {
  let loads = 0;
  await page.route(beacon, async (route) => { loads++; await route.abort(); });
  for (const target of [
    'http://localhost:4173/ambient-portal/',
    'https://preview.example/ambient-portal/',
    'https://hanglark.github.io/other-project/',
    'https://hanglark.github.io/ambient-portal-copy/',
  ]) {
    await mirrorBuild(page, baseURL, target);
    await page.goto(target);
    await expect(page.locator('#start-all')).toBeVisible();
    await expect(page.locator('script[data-cf-beacon]')).toHaveCount(0);
  }
  expect(loads).toBe(0);
});
