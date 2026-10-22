import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/ambient-portal/',
    browserName: 'chromium',
    // Use installed Chrome by default. Set PLAYWRIGHT_CHROMIUM=1 for Playwright's downloaded Chromium.
    channel: process.env.PLAYWRIGHT_CHROMIUM ? undefined : 'chrome',
    locale: 'en-US',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=document-user-activation-required'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/ambient-portal/',
    reuseExistingServer: !process.env.CI,
  },
});
