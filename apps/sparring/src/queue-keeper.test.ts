import { ArenaError, type GameSnapshot, type WireEvent } from "@agenticchess/sdk";
import { describe, expect, it, vi } from "vitest";
import { QueueKeeper, type QueueClient } from "./queue-keeper.js";

const logger = { info: () => {}, error: () => {} };

function keeper(client: QueueClient, now: () => number = () => 1_000): QueueKeeper {
  return new QueueKeeper({ client, logger, now });
}

const joins = (): QueueClient & { calls: number } => {
  const client = {
    calls: 0,
    joinQueue: (): Promise<unknown> => {
      client.calls += 1;
      return Promise.resolve({});
    },
  };
  return client;
};

const hello = (queue: { queuedAt: string; mode: "unrated" } | null, playing = false): WireEvent =>
  ({
    type: "hello",
    agentId: "11111111-1111-4111-8111-111111111111",
    activeGame: playing ? ({ id: "g" } as unknown as GameSnapshot) : null,
    queue,
  }) as WireEvent;

const QUEUED = { queuedAt: "2026-09-05T10:00:00.000Z", mode: "unrated" } as const;

describe("QueueKeeper", () => {
  it("re-joins when a reconnect finds the arena has forgotten us", () => {
    // The failure this exists for: the API deletes the presence key when the
    // stream closes and the matchmaker drops the agent seconds later, so the
    // client reconnects into a queue it is no longer in.
    expect(keeper(joins()).observe(hello(null))).toBe(true);
  });

  it("does not re-join when the arena still has us waiting", () => {
    expect(keeper(joins()).observe(hello(QUEUED))).toBe(false);
  });

  it("does not re-join on reconnect while a game is under way", () => {
    expect(keeper(joins()).observe(hello(null, true))).toBe(false);
  });

  it("re-joins when a game ends and not when one starts", () => {
    const k = keeper(joins());
    expect(k.observe({ type: "game.start" } as unknown as WireEvent)).toBe(false);
    expect(k.observe({ type: "game.end" } as unknown as WireEvent)).toBe(true);
  });

  it("ignores everything else", () => {
    expect(keeper(joins()).observe({ type: "ping", at: "2026-09-05T10:00:00.000Z" })).toBe(false);
  });

  it("joins on demand and remembers when it was confirmed", async () => {
    const client = joins();
    const k = keeper(client);
    await k.ensureQueued();
    expect(client.calls).toBe(1);
    expect(k.isPresent(60_000)).toBe(true);
  });

  it("does not queue while playing", async () => {
    const client = joins();
    const k = keeper(client);
    k.observe({ type: "game.start" } as unknown as WireEvent);
    await k.ensureQueued();
    expect(client.calls).toBe(0);
    expect(k.isPresent(0)).toBe(true);
  });

  it("believes the arena when it says a game is under way", async () => {
    const client = {
      joinQueue: () => Promise.reject(new ArenaError("in_active_game", 409, "playing")),
    };
    const k = keeper(client);
    await k.ensureQueued();
    expect(k.isPresent(0)).toBe(true);
  });

  it("keeps going when the join fails for any other reason", async () => {
    const failing = { joinQueue: () => Promise.reject(new Error("network")) };
    const error = vi.fn();
    const k = new QueueKeeper({ client: failing, logger: { info: () => {}, error }, now: () => 1_000 });
    await expect(k.ensureQueued()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(k.isPresent(60_000)).toBe(false);
  });

  it("stops calling itself present once the confirmation goes stale", async () => {
    let clock = 1_000;
    const k = keeper(joins(), () => clock);
    await k.ensureQueued();
    clock += 30_000;
    expect(k.isPresent(60_000)).toBe(true);
    clock += 40_000;
    expect(k.isPresent(60_000)).toBe(false);
  });

  it("is not present before it has ever queued", () => {
    expect(keeper(joins()).isPresent(60_000)).toBe(false);
  });
});
