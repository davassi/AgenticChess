import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "./errors.js";
import { startHarness, type Harness } from "./test-utils/harness.js";

describe("app basics", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({
      register: (app) => {
        app.get("/__boom", async () => {
          throw new Error("kaboom");
        });
        app.get("/__api-error", async () => {
          throw new ApiError("in_active_game", "Busy", { gameId: "g1" });
        });
        app.post("/__api-error", async () => {
          throw new ApiError("in_active_game", "Busy", { gameId: "g1" });
        });
      },
    });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("reports health with both checks", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { postgres: "ok", redis: "ok" } });
  });

  it("answers unknown routes with the standard body", async () => {
    const res = await h.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "Route not found" });
  });

  it("maps ApiError to its status and body", async () => {
    const res = await h.app.inject({ method: "GET", url: "/__api-error" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "in_active_game", message: "Busy", details: { gameId: "g1" } });
  });

  it("hides unexpected errors behind internal_error with the request id", async () => {
    const res = await h.app.inject({ method: "GET", url: "/__boom", headers: { "x-request-id": "req-42" } });
    expect(res.statusCode).toBe(500);
    expect(res.headers["x-request-id"]).toBe("req-42");
    expect(res.json()).toEqual({
      error: "internal_error",
      message: "Internal error",
      details: { requestId: "req-42" },
    });
  });

  it("turns malformed JSON into validation_error", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/__api-error",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });
});
