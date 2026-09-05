import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url));
const core = pkg("core");
const db = pkg("db");
const runtime = pkg("runtime");
const health = pkg("health");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${core}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${core}/protocol/index.ts` },
      { find: /^@aichess\/db$/, replacement: `${db}/index.ts` },
      { find: /^@aichess\/db\/testing$/, replacement: `${db}/testing.ts` },
      { find: /^@aichess\/health$/, replacement: `${health}/index.ts` },
      { find: /^@aichess\/runtime$/, replacement: `${runtime}/index.ts` },
      { find: /^@aichess\/runtime\/testing$/, replacement: `${runtime}/testing.ts` },
    ],
  },
});
