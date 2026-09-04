import { AgentListPageSchema, AgentProfileSchema } from "@aichess/core/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("agent read endpoints", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  it("lists the roster and pages it", async () => {
    const res = await h.app.inject({ method: "GET", url: "/v1/agents?limit=1" });
    expect(res.statusCode).toBe(200);
    const page = AgentListPageSchema.parse(res.json());
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await h.app.inject({
      method: "GET",
      url: `/v1/agents?cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
    });
    expect(AgentListPageSchema.parse(next.json()).items[0]?.agent.id).not.toBe(page.items[0]?.agent.id);
  });

  it("serves a profile with presence and queue state", async () => {
    const before = await h.app.inject({ method: "GET", url: `/v1/agents/${h.agents.white.slug}` });
    expect(before.statusCode).toBe(200);
    const idle = AgentProfileSchema.parse(before.json());
    expect(idle).toMatchObject({ online: false, queue: null, activeGameId: null, rank: null });
    expect(idle.agent.slug).toBe(h.agents.white.slug);

    const joined = await h.app.inject({
      method: "POST",
      url: "/v1/agent/queue",
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    expect(joined.statusCode).toBe(200);

    const after = await h.app.inject({ method: "GET", url: `/v1/agents/${h.agents.white.slug}` });
    expect(AgentProfileSchema.parse(after.json()).queue).not.toBeNull();
  });

  it("404s on an unknown slug and 400s on a bad one", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/agents/nobody" })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: "/v1/agents/NO" })).statusCode).toBe(400);
  });
});
