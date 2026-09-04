import { defineConfig } from "@playwright/test";

/*
 * Opt-in: this suite needs Postgres, Redis and a browser, so it is not part of
 * `turbo run test`. See apps/web/README.md for the two commands that set it up.
 */
const WEB_PORT = Number(process.env["E2E_WEB_PORT"] ?? 3100);
const API_PORT = Number(process.env["E2E_API_PORT"] ?? 3101);
const database = process.env["DATABASE_URL"] ?? "postgres://aichess:aichess@localhost:5432/aichess";
const redis = process.env["REDIS_URL"] ?? "redis://localhost:6379";

export const E2E_INTERNAL_TOKEN = "e2e-internal-token-0123456789abcdef0123456789";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}` },
  webServer: [
    {
      command: "pnpm --filter @aichess/api start",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        DATABASE_URL: database,
        REDIS_URL: redis,
        API_PORT: String(API_PORT),
        API_HOST: "127.0.0.1",
        WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        INTERNAL_API_TOKEN: E2E_INTERNAL_TOKEN,
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `pnpm --filter @aichess/web start --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        API_PUBLIC_URL: `http://127.0.0.1:${API_PORT}`,
        DATABASE_URL: database,
        AUTH_SECRET: "e2e-secret-0123456789abcdef0123456789abcdef",
        AUTH_GITHUB_ID: "e2e",
        AUTH_GITHUB_SECRET: "e2e",
      },
    },
  ],
});
