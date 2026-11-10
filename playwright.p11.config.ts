import { defineConfig, devices } from "@playwright/test";

const port = 3187;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/p11-playwright",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
