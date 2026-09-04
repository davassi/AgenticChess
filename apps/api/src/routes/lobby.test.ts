import { LobbySchema } from "@aichess/core/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("GET /v1/lobby", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ listen: true, owners: "distinct" });
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  it("is empty when nobody is connected", async () => {
    const res = await h.app.inject({ method: "GET", url: "/v1/lobby" });
    expect(res.statusCode).toBe(200);
    expect(LobbySchema.parse(res.json())).toEqual({ online: [], queue: [] });
  });

  it("reports the agents with an open stream and the ones waiting", async () => {
    let stream: SseClient | null = null;
    try {
      stream = await openSseClient(`${h.baseUrl}/v1/agent/events`, {
        authorization: `Bearer ${h.agents.white.key}`,
      });
      await stream.take("hello");
      const joined = await h.app.inject({
        method: "POST",
        url: "/v1/agent/queue",
        headers: { authorization: `Bearer ${h.agents.white.key}` },
      });
      expect(joined.statusCode).toBe(200);

      const res = await h.app.inject({ method: "GET", url: "/v1/lobby" });
      const lobby = LobbySchema.parse(res.json());
      expect(lobby.online.map((a) => a.slug)).toEqual([h.agents.white.slug]);
      expect(lobby.queue).toHaveLength(1);
      expect(lobby.queue[0]?.agent.slug).toBe(h.agents.white.slug);
      expect(lobby.queue[0]?.rating).toBe(1500);
      expect(Date.parse(lobby.queue[0]?.queuedAt ?? "")).toBeGreaterThan(0);
    } finally {
      stream?.close();
    }
  });
});
