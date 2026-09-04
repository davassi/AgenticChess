import type { QueueStatus } from "@aichess/core/protocol";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness, type SeededAgent } from "../test-utils/harness.js";

describe("agent queue routes", () => {
  let h: Harness;
  const clients: SseClient[] = [];

  beforeAll(async () => {
    h = await startHarness({ listen: true });
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  function auth(agent: SeededAgent): Record<string, string> {
    return { authorization: `Bearer ${agent.key}` };
  }

  async function connect(agent: SeededAgent): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`, auth(agent));
    clients.push(client);
    return client;
  }

  it("joins and leaves the queue with the standard responses", async () => {
    const join = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(join.statusCode).toBe(200);
    const body = join.json() as QueueStatus;
    expect(new Date(body.queuedAt).toISOString()).toBe(body.queuedAt);

    const again = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "already_in_queue" });

    const me = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers: auth(h.agents.white) });
    expect(me.json()).toMatchObject({ queue: { queuedAt: body.queuedAt } });

    const leave = await h.app.inject({ method: "DELETE", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(leave.statusCode).toBe(200);
    expect(leave.json()).toEqual({ queuedAt: body.queuedAt });

    const leaveAgain = await h.app.inject({ method: "DELETE", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(leaveAgain.statusCode).toBe(409);
    expect(leaveAgain.json()).toMatchObject({ error: "not_in_queue" });
    expect(await h.deps.queue.size()).toBe(0);
  });

  it("refuses to queue an agent that is playing", async () => {
    await h.createGame();
    const res = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "in_active_game" });
  });

  it("requires a bearer key on both routes", async () => {
    expect((await h.app.inject({ method: "POST", url: "/v1/agent/queue" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "DELETE", url: "/v1/agent/queue" })).statusCode).toBe(401);
  });

  it("streams queue.joined and queue.left and reports the membership in hello", async () => {
    const first = await connect(h.agents.white);
    const hello = await first.take("hello");
    expect(hello).toMatchObject({ type: "hello", queue: null });

    const join = await h.app.inject({ method: "POST", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    const { queuedAt } = join.json() as QueueStatus;
    expect(await first.take("queue.joined")).toEqual({ type: "queue.joined", queuedAt });

    const second = await connect(h.agents.white);
    expect(await second.take("hello")).toMatchObject({ queue: { queuedAt } });

    await h.app.inject({ method: "DELETE", url: "/v1/agent/queue", headers: auth(h.agents.white) });
    expect(await second.take("queue.left")).toEqual({ type: "queue.left", queuedAt });
  });
});
