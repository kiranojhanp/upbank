import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

/**
 * Dedicated screenshot project. Kept separate from `playwright.config.ts` so
 * `npm run test:e2e` stays fast and deterministic; run `npm run screenshots`
 * to regenerate the images embedded in the root README.
 */
export default defineConfig({
  testDir: './e2e/screenshots',
  testMatch: 'capture.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  outputDir: 'test-results/screenshots',
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'allow',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
})
