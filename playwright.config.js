import { defineConfig } from '@playwright/test';

const deploymentURL = process.env.AMBIENT_TEST_URL;
const localURL = 'http://127.0.0.1:4173/ambient-portal/';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: deploymentURL || localURL,
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
  webServer: deploymentURL ? undefined : {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: localURL,
    reuseExistingServer: !process.env.CI,
  },
});
