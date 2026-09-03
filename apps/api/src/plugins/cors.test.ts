import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("cors", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { WEB_ORIGIN: "http://localhost:3000" } });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("allows the configured web origin for GET", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:3000" } });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("never reflects a foreign origin", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health", headers: { origin: "http://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).not.toBe("http://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("answers preflight with GET only", async () => {
    const res = await h.app.inject({
      method: "OPTIONS",
      url: "/v1/games/x",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
    });
    expect(res.headers["access-control-allow-methods"]).toBe("GET");
  });
});
