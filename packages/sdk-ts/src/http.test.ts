import { describe, expect, it } from "vitest";
import { ArenaError } from "./errors.js";
import { ArenaHttp, type FetchLike } from "./http.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function build(responses: Array<Response | Error>): { http: ArenaHttp; calls: RequestInit[]; urls: string[] } {
  const calls: RequestInit[] = [];
  const urls: string[] = [];
  const queue = [...responses];
  const fetchLike = ((url: string, init?: RequestInit): Promise<Response> => {
    urls.push(url);
    calls.push(init ?? {});
    const next = queue.shift();
    if (next === undefined) throw new Error("fetch called more times than the test allows");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as FetchLike;

  const http = new ArenaHttp({
    baseUrl: "https://api.example/",
    apiKey: "ac_test",
    fetch: fetchLike,
    sleep: async () => {},
    random: () => 0.5,
  });
  return { http, calls, urls };
}

describe("ArenaHttp", () => {
  it("sends the bearer key and returns the parsed body", async () => {
    const { http, calls, urls } = build([jsonResponse(200, { queuedAt: "2026-09-04T10:00:00.000Z" })]);

    const body = await http.requestJson<{ queuedAt: string }>("POST", "/v1/agent/queue");

    expect(body.queuedAt).toBe("2026-09-04T10:00:00.000Z");
    expect(urls[0]).toBe("https://api.example/v1/agent/queue");
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer ac_test");
  });

  it("turns a rejected move into an ArenaError carrying the details", async () => {
    const { http } = build([
      jsonResponse(422, {
        error: "illegal_move",
        message: "Not a legal move",
        details: { reason: "not_legal", attemptsLeft: 2 },
      }),
    ]);

    await expect(http.requestJson("POST", "/v1/games/g1/move", { ply: 4, move: "Qh9" })).rejects.toMatchObject({
      code: "illegal_move",
      status: 422,
    });
  });

  it("retries a 503 with the same body and succeeds", async () => {
    const { http, calls } = build([
      jsonResponse(503, { error: "service_unavailable", message: "down" }),
      jsonResponse(200, { ok: true }),
    ]);

    const body = await http.requestJson<{ ok: boolean }>("POST", "/v1/games/g1/move", { ply: 4, move: "e4" });

    expect(body.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toBe(calls[1]?.body);
  });

  it("retries a network failure", async () => {
    const { http, calls } = build([new TypeError("fetch failed"), jsonResponse(200, { ok: true })]);

    await http.requestJson("GET", "/v1/agent/me");

    expect(calls).toHaveLength(2);
  });

  it("gives up after maxAttempts and reports the arena unreachable", async () => {
    const { http, calls } = build([
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    ]);

    const error = await http.requestJson("GET", "/v1/agent/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArenaError);
    expect((error as ArenaError).code).toBe("service_unavailable");
    expect(calls).toHaveLength(3);
  });

  it("preserves the arena's own error body when repeated 503s exhaust every retry", async () => {
    const { http, calls } = build([
      jsonResponse(503, { error: "rate_limited", message: "arena is over capacity, slow down" }),
      jsonResponse(503, { error: "rate_limited", message: "arena is over capacity, slow down" }),
      jsonResponse(503, { error: "rate_limited", message: "arena is over capacity, slow down" }),
    ]);

    const error = await http.requestJson("GET", "/v1/agent/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArenaError);
    expect((error as ArenaError).status).toBe(503);
    // "rate_limited" is deliberately not "service_unavailable" - the code the network-failure
    // exhaustion path synthesises - so this assertion cannot pass if 503 exhaustion were ever
    // routed through that synthetic branch instead of the arena's own response body.
    expect((error as ArenaError).code).toBe("rate_limited");
    expect(calls).toHaveLength(3);
  });

  it("never retries a 4xx, because repeating an illegal move burns the turn", async () => {
    const { http, calls } = build([jsonResponse(409, { error: "not_your_turn", message: "wait" })]);

    await expect(http.requestJson("POST", "/v1/games/g1/move", { ply: 4, move: "e4" })).rejects.toBeInstanceOf(
      ArenaError,
    );
    expect(calls).toHaveLength(1);
  });

  it("waits between retries using the injected sleep", async () => {
    const slept: number[] = [];
    const queue = [jsonResponse(503, {}), jsonResponse(200, { ok: true })];
    const fetchLike = ((): Promise<Response> => Promise.resolve(queue.shift() as Response)) as unknown as FetchLike;
    const http = new ArenaHttp({
      baseUrl: "https://api.example",
      apiKey: "ac_test",
      fetch: fetchLike,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
      random: () => 1,
    });

    await http.requestJson("GET", "/v1/agent/me");

    expect(slept).toEqual([250]);
  });

  it("asks for the event stream and does not retry the open", async () => {
    const { http, calls } = build([new Response("", { status: 200 })]);

    await http.open("/v1/agent/events", new AbortController().signal);

    expect(calls).toHaveLength(1);
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers["accept"]).toBe("text/event-stream");
  });
});
