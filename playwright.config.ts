import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT || 3200)

/**
 * End-to-end tests of the canvas against the standalone build, with the
 * chat API mocked in the browser (no model calls). Run `npm run build` first.
 */
export default defineConfig({
    testDir: "tests/e2e",
    timeout: 60_000,
    // One app instance; tests share its in-memory state only via the browser
    fullyParallel: false,
    workers: 1,
    reporter: [["list"]],
    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1400, height: 900 },
        trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: "node scripts/serve-standalone.mjs",
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        env: {
            PORT: String(PORT),
            // The model is mocked; no access code, no provider credentials
            ACCESS_CODE: "",
            AI_PROVIDER: "bedrock",
        },
    },
})
