import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreSrc = fileURLToPath(new URL("../core/src", import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: [
      { find: /^@aichess\/core$/, replacement: `${coreSrc}/index.ts` },
      { find: /^@aichess\/core\/protocol$/, replacement: `${coreSrc}/protocol/index.ts` },
    ],
  },
});
