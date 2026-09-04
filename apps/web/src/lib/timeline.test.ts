import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./http";
import { fetchTimelineAt } from "./timeline";

const TIMELINE = {
  moves: [
    {
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      comment: null,
      thinkTimeMs: 900,
      at: "2026-09-04T10:00:10.000Z",
    },
  ],
  attempts: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTimelineAt", () => {
  it("reads the timeline from the public API address", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse(TIMELINE)));
    const timeline = await fetchTimelineAt("https://api.example.test", "a b");
    expect(timeline.moves).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/games/a%20b/moves");
  });

  it("turns a refusal into a typed error rather than a rejected promise of nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: "not_found", message: "no such game" }, 404)),
    );
    await expect(fetchTimelineAt("https://api.example.test", "x")).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("reports a shape the API should never have sent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse({ moves: "no" })));
    await expect(fetchTimelineAt("https://api.example.test", "x")).rejects.toThrow(/unexpected shape/);
  });
});
