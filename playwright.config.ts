import { defineConfig, devices } from "@playwright/test";

/**
 * 家长看板 E2E 配置。
 * 用例一律经 tests/e2e/fixtures/board.ts 拦截 Supabase：
 * 直连线上会让断言随孩子的真实进度漂移，用例不可复现。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:5399",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --port 5399 --strictPort",
    url: "http://localhost:5399",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
