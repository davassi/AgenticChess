import { describe, expect, it } from "vitest";
import { AgenticChessClient } from "./client.js";
import { fakeFetch, jsonResponse } from "./testing.js";

const queued = { queuedAt: "2026-09-04T10:00:00.000Z" };

function build(script: Array<Response | Error>): {
  client: AgenticChessClient;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const fake = fakeFetch(script);
  const client = new AgenticChessClient({
    apiKey: "ac_test",
    baseUrl: "https://api.example",
    fetch: fake.fetch,
    sleep: async () => {},
    now: () => Date.parse("2026-09-04T10:00:00.000Z"),
    random: () => 0.5,
  });
  return { client, calls: fake.calls };
}

describe("AgenticChessClient requests", () => {
  it("joins the queue", async () => {
    const { client, calls } = build([jsonResponse(200, queued)]);

    const status = await client.joinQueue();

    expect(status.queuedAt).toBe(queued.queuedAt);
    expect(calls[0]?.url).toBe("https://api.example/v1/agent/queue");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("treats already_in_queue as success, because a retried join is still a join", async () => {
    const { client, calls } = build([
      jsonResponse(409, { error: "already_in_queue", message: "already waiting" }),
      jsonResponse(200, { agent: {}, status: "active", online: true, activeGameId: null, queue: queued, rating: {} }),
    ]);

    const status = await client.joinQueue();

    expect(status.queuedAt).toBe(queued.queuedAt);
    expect(calls[1]?.url).toBe("https://api.example/v1/agent/me");
  });

  it("re-throws already_in_queue when the arena then says we are not queued after all", async () => {
    const { client } = build([
      jsonResponse(409, { error: "already_in_queue", message: "already waiting" }),
      jsonResponse(200, { agent: {}, status: "active", online: true, activeGameId: null, queue: null, rating: {} }),
    ]);

    await expect(client.joinQueue()).rejects.toMatchObject({ code: "already_in_queue" });
  });

  it("treats not_in_queue as success when leaving, so leaving twice is safe", async () => {
    const { client } = build([jsonResponse(409, { error: "not_in_queue", message: "nothing to leave" })]);

    await expect(client.leaveQueue()).resolves.toBeNull();
  });

  it("posts a move with the ply the turn named", async () => {
    const { client, calls } = build([jsonResponse(200, { id: "g1", status: "active" })]);

    await client.move("g1", 4, "Nf3", "Developing.");

    expect(calls[0]?.url).toBe("https://api.example/v1/games/g1/move");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ ply: 4, move: "Nf3", comment: "Developing." });
  });

  it("omits the comment when there is none, rather than sending null", async () => {
    const { client, calls } = build([jsonResponse(200, { id: "g1" })]);

    await client.move("g1", 4, "Nf3");

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ ply: 4, move: "Nf3" });
  });

  it("resigns", async () => {
    const { client, calls } = build([jsonResponse(200, { id: "g1", status: "finished" })]);

    await client.resign("g1");

    expect(calls[0]?.url).toBe("https://api.example/v1/games/g1/resign");
  });
});
