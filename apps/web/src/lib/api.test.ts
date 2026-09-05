import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  fetchAgent,
  fetchAllAgents,
  fetchGames,
  fetchLeaderboard,
  isMissingOrMalformed,
  isNotFound,
} from "./api";

const RATING = { rating: 1500, rd: 350, gamesPlayed: 0, provisional: true };

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
  isHouse: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env["API_PUBLIC_URL"] = "http://api.test";
    process.env["DATABASE_URL"] = "postgres://aichess:aichess@localhost:5432/aichess";
    process.env["AUTH_SECRET"] = "0123456789abcdef0123456789abcdef";
    process.env["AUTH_GITHUB_ID"] = "id";
    process.env["AUTH_GITHUB_SECRET"] = "secret";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the query string, skipping absent filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    await fetchGames({ limit: 20, agent: "opusbot" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://api.test/v1/games?limit=20&agent=opusbot");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("parses a well-formed page", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ rank: 1, agent: AGENT, rating: 1688, rd: 62, gamesPlayed: 41 }],
        nextCursor: null,
      }),
    );
    const page = await fetchLeaderboard({ limit: 10 });
    expect(page.items[0]?.agent.slug).toBe("opusbot");
  });

  it("turns an API error body into an ApiRequestError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "not_found", message: "Agent not found" }, 404));
    const failure = await fetchAgent("nobody").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect(isNotFound(failure)).toBe(true);
    expect((failure as ApiRequestError).code).toBe("not_found");
    expect((failure as ApiRequestError).message).toBe("Agent not found");
  });

  it("refuses a body that does not match the schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ rank: 0 }], nextCursor: null }));
    await expect(fetchLeaderboard({ limit: 10 })).rejects.toThrow(/unexpected shape/);
  });

  it("reports a dead API as service_unavailable instead of leaking the network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const failure = await fetchLeaderboard({ limit: 10 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).code).toBe("service_unavailable");
  });

  it("walks every roster page, so a filter knows the agents after the first hundred", async () => {
    const item = { agent: AGENT, description: "", status: "active", rating: RATING };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [item], nextCursor: "second" }))
      .mockResolvedValueOnce(jsonResponse({ items: [item], nextCursor: null }));
    const all = await fetchAllAgents();
    expect(all).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=second");
  });

  it("stops walking the roster at the page cap", async () => {
    const item = { agent: AGENT, description: "", status: "active", rating: RATING };
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ items: [item], nextCursor: "again" })));
    expect(await fetchAllAgents(3)).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends a malformed path parameter to the 404 page, not to the error page", async () => {
    const error = new ApiRequestError(400, "validation_error", "id must be a uuid");
    expect(isMissingOrMalformed(error)).toBe(true);
    expect(isNotFound(error)).toBe(false);
    expect(isMissingOrMalformed(new ApiRequestError(503, "service_unavailable", "down"))).toBe(false);
  });

  it("escapes path parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    await fetchGames({});
    fetchMock.mockResolvedValue(jsonResponse({ error: "not_found", message: "no" }, 404));
    await fetchAgent("a/b").catch(() => undefined);
    const [url] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toBe("http://api.test/v1/agents/a%2Fb");
  });
});
