import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_INTERNAL_TOKEN, startHarness, type Harness } from "./test-utils/harness.js";

const INTERVAL_MS = 400;

/**
 * The arena's pacing has to survive the trip through the API's own wiring.
 *
 * It did not: `createDeps` built the runtime config by hand instead of through
 * `runtimeConfigFrom`, so `MIN_MOVE_INTERVAL_MS` was parsed, validated, shipped
 * and then dropped one line before it was used. Every move in production went
 * at full speed with the variable set to 3000 and nothing reporting a problem.
 * A unit test of the mapping could not see it; only a move through the API can.
 */
describe("minimum move interval, through the API", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ env: { MIN_MOVE_INTERVAL_MS: String(INTERVAL_MS) } });
  });

  afterAll(async () => {
    await h.stop();
  });

  it("holds a move that arrives sooner than the interval", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/v1/internal/games",
      headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
      payload: { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const started = Date.now();
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/games/${id}/move`,
      headers: { authorization: `Bearer ${h.agents.white.key}` },
      payload: { ply: 0, move: "e4" },
    });
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(200);
    // Some slack below the interval for the clock, none above: the point is
    // that the wait happened at all, not that it was exact.
    expect(elapsed).toBeGreaterThanOrEqual(INTERVAL_MS - 50);
  });
});
