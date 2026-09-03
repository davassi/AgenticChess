import { describe, expect, it } from "vitest";
import { startHealthServer } from "./health.js";

describe("worker health server", () => {
  it("reports ok or degraded from the check", async () => {
    let healthy = true;
    const server = await startHealthServer({ host: "127.0.0.1", port: 0, check: async () => healthy });
    try {
      const ok = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ status: "ok" });
      healthy = false;
      const degraded = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(degraded.status).toBe(503);
      expect((await fetch(`http://127.0.0.1:${server.port}/other`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
