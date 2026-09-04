import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { listOnlineAgentIds, presenceKeyFor } from "./presence.js";

/** Enough of Redis for the scan: one page of keys, then the end of the cursor. */
function fakeRedis(keys: string[]): Redis {
  return {
    scan: async (): Promise<[string, string[]]> => ["0", keys],
  } as unknown as Redis;
}

describe("listOnlineAgentIds", () => {
  const keys = [presenceKeyFor("a"), `${presenceKeyFor("a")}:instances`, presenceKeyFor("b")];

  it("reads the agent ids and skips the per-instance sets", async () => {
    expect(await listOnlineAgentIds(fakeRedis(keys), 10)).toEqual(["a", "b"]);
  });

  it("stops at the limit", async () => {
    expect(await listOnlineAgentIds(fakeRedis(keys), 1)).toEqual(["a"]);
  });

  it("returns nobody when there is no room for anybody", async () => {
    // The bound is checked after the push, so a limit of zero used to let one
    // agent through — and a caller asking for none means none.
    expect(await listOnlineAgentIds(fakeRedis(keys), 0)).toEqual([]);
    expect(await listOnlineAgentIds(fakeRedis(keys), -1)).toEqual([]);
  });
});
