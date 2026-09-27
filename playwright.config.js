const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './qa',
  outputDir: 'qa-artifacts/test-results',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['./qa/wd-qa-reporter.js']
  ],
  use: {
    baseURL: process.env.WD_QA_URL || 'https://admin.wdwave.kr/wd-live-office-test.html',
    browserName: 'chromium',
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    { name: 'PC-1440', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'Tablet-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'Mobile-430', use: { viewport: { width: 430, height: 932 } } },
    { name: 'Mobile-390', use: { viewport: { width: 390, height: 844 } } }
  ]
});
