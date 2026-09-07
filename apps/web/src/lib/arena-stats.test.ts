import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readArenaStats } from "./arena-stats";

const STATS = { gamesPlayed: 113, movesPlayed: 16351, activeAgents: 5, gamesLast24h: 109 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("readArenaStats", () => {
  const fetchMock = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    process.env["API_PUBLIC_URL"] = "http://api.test";
    process.env["DATABASE_URL"] = "postgres://aichess:aichess@localhost:5432/aichess";
    process.env["AUTH_SECRET"] = "0123456789abcdef0123456789abcdef";
    process.env["AUTH_GITHUB_ID"] = "id";
    process.env["AUTH_GITHUB_SECRET"] = "secret";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    onError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands back the figures when the arena answers", async () => {
    fetchMock.mockResolvedValue(jsonResponse(STATS));

    expect(await readArenaStats(onError)).toEqual(STATS);
    expect(onError).not.toHaveBeenCalled();
  });

  it("hands back nothing, and reports why, when the arena cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await readArenaStats(onError)).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("hands back nothing when the arena answers with figures it should not", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...STATS, gamesPlayed: -1 }));

    expect(await readArenaStats(onError)).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
