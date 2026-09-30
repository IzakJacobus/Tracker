import { defineConfig, devices } from "@playwright/test";

export const BASE_URL = "http://localhost:47651";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    viewport: { width: 1360, height: 900 },
    timezoneId: "Africa/Johannesburg",
    acceptDownloads: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
  ],
  webServer: {
    command: "bun e2e/server.ts",
    cwd: "..",
    url: `${BASE_URL}/api/info`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
  },
});
