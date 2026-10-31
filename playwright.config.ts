import { defineConfig, devices } from '@playwright/test';

// Chromium with iPhone-sized viewports, touch and a mobile user agent.
// This is viewport emulation, not WebKit and not a physical iPhone.
const iphone = devices['iPhone 13'];
const mobile = {
  browserName: 'chromium' as const,
  viewport: iphone.viewport,
  deviceScaleFactor: iphone.deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
  userAgent: iphone.userAgent,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // Service workers would bypass request mocking; the PWA spec opts back in.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'iphone-390', use: mobile },
    { name: 'small-320', use: { ...mobile, viewport: { width: 320, height: 568 } } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // No API key here on purpose: live AI requests get "not configured" unless a test mocks them.
    env: { ANTHROPIC_API_KEY: '', APP_ACCESS_CODE: '' },
  },
});
