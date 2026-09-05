import type { AgentSummary, GameListItem, Lobby } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { rollCall } from "./arena";

function agent(name: string): AgentSummary {
  return {
    id: `id-${name}`,
    name,
    slug: name,
    modelProvider: "Anthropic",
    modelName: "claude-opus-5",
    isHouse: false,
  };
}

const ALICE = agent("alice");
const BOB = agent("bob");
const CARLA = agent("carla");
const DAN = agent("dan");

function game(white: AgentSummary, black: AgentSummary): GameListItem {
  return {
    id: `game-${white.name}-${black.name}`,
    status: "active",
    rated: true,
    white,
    black,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    ply: 0,
    turn: "white",
    result: null,
    termination: null,
    moveDeadlineAt: null,
    createdAt: "2026-09-04T09:00:00.000Z",
    startedAt: "2026-09-04T09:00:00.000Z",
    finishedAt: null,
  };
}

describe("rollCall", () => {
  const lobby: Lobby = {
    online: [ALICE, BOB, CARLA, DAN],
    queue: [{ agent: CARLA, rating: 1500, queuedAt: "2026-09-04T09:59:00.000Z" }],
  };

  it("counts an agent playing on a board the page has no room for", () => {
    // The classification reads every game in progress, not the six the arena
    // draws: with the short list, alice and bob came out idle.
    const drawn = game(ALICE, BOB);
    const beyond = game(CARLA, DAN);
    const roll = rollCall(lobby, [drawn, beyond], [ALICE, BOB, CARLA, DAN]);
    expect(roll.playing.map((one) => one.name)).toEqual(["alice", "bob", "carla", "dan"]);
    expect(roll.idle).toEqual([]);
    expect(roll.offline).toEqual([]);
  });

  it("separates the ones waiting from the ones just standing there", () => {
    const roll = rollCall(lobby, [game(ALICE, BOB)], [ALICE, BOB, CARLA, DAN]);
    // carla is in the queue, dan is online with nothing to do.
    expect(roll.idle.map((one) => one.name)).toEqual(["dan"]);
    expect(roll.playing.map((one) => one.name)).toEqual(["alice", "bob"]);
  });

  it("calls an agent offline only when it is neither online nor at a board", () => {
    const away = agent("edith");
    const roll = rollCall({ online: [ALICE], queue: [] }, [], [ALICE, away]);
    expect(roll.offline.map((one) => one.name)).toEqual(["edith"]);
  });

  it("never calls an agent offline while it is waiting in the queue", () => {
    // Joining the queue does not require an open stream, so a queued agent can
    // be absent from `online` — and it was then listed under both "In queue"
    // and "Offline" on the same page.
    const roll = rollCall(
      { online: [], queue: [{ agent: BOB, rating: 1500, queuedAt: "2026-09-04T09:59:00.000Z" }] },
      [],
      [ALICE, BOB],
    );
    expect(roll.offline.map((one) => one.name)).toEqual(["alice"]);
  });
});
