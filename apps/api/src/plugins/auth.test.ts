import { agents } from "@aichess/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";
import { assertAgent, optionalAgent, requireAgent } from "./auth.js";

describe("bearer authentication", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({
      register: (app, deps) => {
        app.get("/__whoami", { preHandler: requireAgent(deps) }, async (request) => ({ id: assertAgent(request).id }));
        app.get("/__maybe", { preHandler: optionalAgent(deps) }, async (request) => ({
          agent: request.agent?.id ?? null,
        }));
        app.get("/__db-down", async () => {
          throw Object.assign(new Error("Failed query"), { cause: { code: "57P01" } });
        });
        app.get("/__redis-down", async () => {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        });
      },
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("rejects a missing header", async () => {
    const res = await h.app.inject({ method: "GET", url: "/__whoami" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized", message: "Missing Authorization header" });
  });

  it("rejects a malformed header and an unknown key", async () => {
    expect(
      (await h.app.inject({ method: "GET", url: "/__whoami", headers: { authorization: "Token abc" } })).statusCode,
    ).toBe(401);
    expect(
      (await h.app.inject({ method: "GET", url: "/__whoami", headers: { authorization: "Bearer nope" } })).statusCode,
    ).toBe(401);
    const almost = `${h.agents.white.key.slice(0, -1)}x`;
    expect(
      (await h.app.inject({ method: "GET", url: "/__whoami", headers: { authorization: `Bearer ${almost}` } }))
        .statusCode,
    ).toBe(401);
  });

  it("resolves a valid key to its agent", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/__whoami",
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: h.agents.white.id });
  });

  it("refuses a suspended agent with 403", async () => {
    await h.db
      .update(agents)
      .set({ status: "suspended", suspendedReason: "test" })
      .where(eq(agents.id, h.agents.black.id));
    const res = await h.app.inject({
      method: "GET",
      url: "/__whoami",
      headers: { authorization: `Bearer ${h.agents.black.key}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("agent_suspended");
    await h.db.update(agents).set({ status: "active", suspendedReason: null }).where(eq(agents.id, h.agents.black.id));
  });

  it("treats the header as optional where allowed but still validates it", async () => {
    expect((await h.app.inject({ method: "GET", url: "/__maybe" })).json()).toEqual({ agent: null });
    const withKey = await h.app.inject({
      method: "GET",
      url: "/__maybe",
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    expect(withKey.json()).toEqual({ agent: h.agents.white.id });
    expect(
      (await h.app.inject({ method: "GET", url: "/__maybe", headers: { authorization: "Bearer nope" } })).statusCode,
    ).toBe(401);
  });

  it("maps connectivity failures to 503", async () => {
    const db = await h.app.inject({ method: "GET", url: "/__db-down" });
    expect(db.statusCode).toBe(503);
    expect(db.json().error).toBe("service_unavailable");
    const redis = await h.app.inject({ method: "GET", url: "/__redis-down" });
    expect(redis.statusCode).toBe(503);
  });
});
