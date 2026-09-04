import { generateApiKey } from "@aichess/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";
import { requireAgent } from "./auth.js";
import { agentRateLimit } from "./rate-limit.js";

describe("rate limiting", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({
      env: { RATE_LIMIT_PUBLIC_PER_MINUTE: "3", RATE_LIMIT_AGENT_PER_MINUTE: "2" },
      register: (app, deps) => {
        app.get("/__public", async () => ({ ok: true }));
        app.get("/__agent", { preHandler: [requireAgent(deps), agentRateLimit(deps)] }, async () => ({
          ok: true,
        }));
      },
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("limits anonymous callers per IP with the standard body", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await h.app.inject({ method: "GET", url: "/__public", remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
    }
    const blocked = await h.app.inject({ method: "GET", url: "/__public", remoteAddress: "10.0.0.1" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.json()).toMatchObject({ error: "rate_limited", details: { retryAfterMs: expect.any(Number) } });
    expect((await h.app.inject({ method: "GET", url: "/__public", remoteAddress: "10.0.0.2" })).statusCode).toBe(200);
  });

  it("limits agents per API key on agent routes", async () => {
    const headers = { authorization: `Bearer ${h.agents.white.key}` };
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers, remoteAddress: "10.0.0.3" })).statusCode,
    ).toBe(200);
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers, remoteAddress: "10.0.0.4" })).statusCode,
    ).toBe(200);
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers, remoteAddress: "10.0.0.5" })).statusCode,
    ).toBe(429);
    const other = { authorization: `Bearer ${h.agents.black.key}` };
    expect(
      (await h.app.inject({ method: "GET", url: "/__agent", headers: other, remoteAddress: "10.0.0.5" })).statusCode,
    ).toBe(200);
  });

  it("never limits the health check", async () => {
    for (let i = 0; i < 6; i += 1) {
      expect((await h.app.inject({ method: "GET", url: "/health", remoteAddress: "10.0.0.9" })).statusCode).toBe(200);
    }
  });

  it("counts a well-formed fake Bearer token against the client IP, not a fresh bucket", async () => {
    const ip = "10.8.8.8";
    for (let i = 0; i < 3; i += 1) {
      const fake = generateApiKey().key;
      const res = await h.app.inject({
        method: "GET",
        url: "/__public",
        headers: { authorization: `Bearer ${fake}` },
        remoteAddress: ip,
      });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await h.app.inject({
      method: "GET",
      url: "/__public",
      headers: { authorization: `Bearer ${generateApiKey().key}` },
      remoteAddress: ip,
    });
    expect(blocked.statusCode).toBe(429);
  });
});
