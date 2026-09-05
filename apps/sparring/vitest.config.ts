import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string): string => fileURLToPath(new URL(`../../packages/${path}/src`, import.meta.url));
const core = src("core");
const sdk = src("sdk-ts");
const health = src("health");

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${core}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${core}/protocol/index.ts` },
      { find: /^@agenticchess\/sdk$/, replacement: `${sdk}/index.ts` },
      { find: /^@aichess\/health$/, replacement: `${health}/index.ts` },
    ],
  },
});
