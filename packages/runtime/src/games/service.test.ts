import { randomUUID } from "node:crypto";
import { DEFAULT_GAME_CONFIG, NETWORK_GRACE_MS, type WireEvent } from "@aichess/core/protocol";
import { games, moveAttempts, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus, createRedis } from "../events/bus.js";
import type { GameAgents } from "../events/wire.js";
import { createDeadlineQueue, deadlineJobId, type DeadlineQueue } from "../jobs/deadlines.js";
import { noopLogger } from "../logger.js";
import { seedTwoAgents, startTestRedis, type TestRedis } from "../testing.js";
import { GameService } from "./service.js";

const T0 = Date.UTC(2026, 8, 3, 10, 0, 0);

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("GameService", () => {
  let tdb: TestDatabase;
  let redis: TestRedis;
  let db: Database;
  let bus: EventBus;
  let connection: Redis;
  let queue: DeadlineQueue;
  let agents: GameAgents;
  let clock: number;
  let service: GameService;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    redis = await startTestRedis();
    db = tdb.db;
    bus = await EventBus.connect(redis.url, noopLogger);
    connection = createRedis(redis.url);
    await connection.connect();
    queue = createDeadlineQueue(connection);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
    await bus.close();
    await redis.stop();
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    await queue.obliterate({ force: true });
    agents = await seedTwoAgents(db);
    clock = T0;
    service = new GameService({
      db,
      bus,
      deadlines: queue,
      config: DEFAULT_GAME_CONFIG,
      logger: noopLogger,
      now: () => clock,
    });
  });

  async function newGame(): Promise<string> {
    const r = await service.createAndStartGame({ whiteAgentId: agents.white.id, blackAgentId: agents.black.id });
    if (!r.ok) throw new Error(r.code);
    return r.snapshot.id;
  }

  async function play(gameId: string, san: string): Promise<void> {
    const snapshot = await service.getSnapshot(gameId);
    if (snapshot === null) throw new Error("game missing");
    const agentId = snapshot.turn === "white" ? agents.white.id : agents.black.id;
    clock += 1_000;
    const r = await service.submitMove({ gameId, agentId, ply: snapshot.ply, move: san });
    if (!r.ok) throw new Error(`move ${san} rejected: ${r.code}`);
  }

  describe("createAndStartGame", () => {
    it("creates an active game, notifies both agents and schedules the first deadline", async () => {
      const white: WireEvent[] = [];
      const black: WireEvent[] = [];
      const pub: WireEvent[] = [];
      const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
      const offBlack = await bus.subscribeAgent(agents.black.id, (e) => black.push(e));

      const r = await service.createAndStartGame({ whiteAgentId: agents.white.id, blackAgentId: agents.black.id });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const offPublic = await bus.subscribeGame(r.snapshot.id, (e) => pub.push(e));

      expect(r.snapshot).toMatchObject({
        status: "active",
        ply: 0,
        turn: "white",
        white: agents.white,
        black: agents.black,
        moveDeadlineAt: new Date(T0 + 60_000).toISOString(),
        startedAt: new Date(T0).toISOString(),
      });
      expect(r.snapshot.legalMoves).toBeUndefined();

      await waitFor(() => white.length === 2 && black.length === 1);
      expect(white.map((e) => e.type)).toEqual(["game.start", "game.your_turn"]);
      expect(black.map((e) => e.type)).toEqual(["game.start"]);

      const job = await queue.getJob(deadlineJobId(r.snapshot.id, 0));
      expect(job?.data).toEqual({ gameId: r.snapshot.id, ply: 0 });
      expect(job?.opts.delay).toBe(60_000 + NETWORK_GRACE_MS);

      const [row] = await db.select().from(games).where(eq(games.id, r.snapshot.id));
      expect(row?.status).toBe("active");

      await offWhite();
      await offBlack();
      await offPublic();
    });

    it("applies a config override", async () => {
      const r = await service.createAndStartGame({
        whiteAgentId: agents.white.id,
        blackAgentId: agents.black.id,
        config: { timePerMoveMs: 5_000 },
      });
      if (!r.ok) throw new Error(r.code);
      expect(r.snapshot.config).toEqual({ ...DEFAULT_GAME_CONFIG, timePerMoveMs: 5_000 });
      expect(r.snapshot.moveDeadlineAt).toBe(new Date(T0 + 5_000).toISOString());
    });

    it("fails when an agent does not exist", async () => {
      const r = await service.createAndStartGame({ whiteAgentId: agents.white.id, blackAgentId: randomUUID() });
      expect(r).toEqual({ ok: false, code: "agents_not_found" });
    });
  });

  describe("getSnapshot", () => {
    it("returns legal moves only to the agent on move", async () => {
      const gameId = await newGame();
      expect((await service.getSnapshot(gameId, agents.white.id))?.legalMoves).toHaveLength(20);
      expect((await service.getSnapshot(gameId, agents.black.id))?.legalMoves).toBeUndefined();
      expect((await service.getSnapshot(gameId))?.legalMoves).toBeUndefined();
      expect(await service.getSnapshot(randomUUID())).toBeNull();
    });
  });

  describe("submitMove", () => {
    it("plays a whole game to checkmate, publishing every step and storing the pgn", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const black: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
      const offBlack = await bus.subscribeAgent(agents.black.id, (e) => black.push(e));

      clock += 1_500;
      const first = await service.submitMove({
        gameId,
        agentId: agents.white.id,
        ply: 0,
        move: "f3",
        comment: "Testing.",
      });
      expect(first).toMatchObject({ ok: true, idempotent: false });
      if (!first.ok) return;
      expect(first.snapshot.ply).toBe(1);
      expect(first.snapshot.turn).toBe("black");
      expect(first.snapshot.moveDeadlineAt).toBe(new Date(T0 + 1_500 + 60_000).toISOString());

      for (const san of ["e5", "g4"]) await play(gameId, san);
      const snapshot = await service.getSnapshot(gameId);
      clock += 1_000;
      const last = await service.submitMove({
        gameId,
        agentId: agents.black.id,
        ply: snapshot?.ply ?? -1,
        move: "Qh4#",
      });
      if (!last.ok) throw new Error(last.code);
      expect(last.snapshot).toMatchObject({
        status: "finished",
        result: "0-1",
        termination: "checkmate",
        moveDeadlineAt: null,
      });

      await waitFor(() => pub.filter((e) => e.type === "game.end").length === 1);
      expect(pub.map((e) => e.type)).toEqual([
        "game.move",
        "game.turn",
        "game.move",
        "game.turn",
        "game.move",
        "game.turn",
        "game.move",
        "game.end",
      ]);
      const end = pub[pub.length - 1];
      if (end?.type !== "game.end") throw new Error("expected game.end");
      expect(end.pgn).toContain("Qh4#");
      expect(end.rating).toBeNull();
      expect(black.filter((e) => e.type === "game.your_turn")).toHaveLength(2);

      const [row] = await db.select().from(games).where(eq(games.id, gameId));
      expect(row?.pgn).toContain('[Result "0-1"]');
      for (const ply of [0, 1, 2, 3]) {
        expect(await queue.getJob(deadlineJobId(gameId, ply))).toBeDefined();
      }

      await offPublic();
      await offBlack();
    });

    it("rejects an illegal move, records the attempt and tells spectators", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));

      const r = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "Nf6" });
      expect(r.ok).toBe(false);
      if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
      expect(r.reason).toBe("not_legal");
      expect(r.attemptsLeft).toBe(2);
      expect(r.legalMoves).toHaveLength(20);
      expect(r.snapshot.attemptsLeft).toBe(2);
      expect(r.snapshot.legalMoves).toHaveLength(20);

      await waitFor(() => pub.length === 1);
      expect(pub[0]).toMatchObject({
        type: "game.illegal_attempt",
        color: "white",
        ply: 0,
        submitted: "Nf6",
        attemptsLeft: 2,
      });
      expect(await db.select().from(moveAttempts).where(eq(moveAttempts.gameId, gameId))).toHaveLength(1);
      await offPublic();
    });

    it("forfeits after three illegal attempts", async () => {
      const gameId = await newGame();
      const white: WireEvent[] = [];
      const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
      for (let i = 0; i < 3; i += 1) {
        const r = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "Ke2" });
        if (r.ok || r.code !== "illegal_move") throw new Error("expected illegal_move");
        if (i === 2) {
          expect(r.attemptsLeft).toBe(0);
          expect(r.snapshot).toMatchObject({ status: "finished", result: "0-1", termination: "illegal_moves" });
        }
      }
      await waitFor(() => white.some((e) => e.type === "game.end"));
      await offWhite();
    });

    it("treats a replayed move as idempotent without republishing", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
      const first = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e4" });
      expect(first).toMatchObject({ ok: true, idempotent: false });
      await waitFor(() => pub.length === 2);
      const replay = await service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e2e4" });
      expect(replay).toMatchObject({ ok: true, idempotent: true });
      if (!replay.ok) return;
      expect(replay.snapshot.ply).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pub).toHaveLength(2);
      await offPublic();
    });

    it("maps guard failures to stable codes", async () => {
      const gameId = await newGame();
      expect(await service.submitMove({ gameId: randomUUID(), agentId: agents.white.id, ply: 0, move: "e4" })).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await service.submitMove({ gameId, agentId: randomUUID(), ply: 0, move: "e4" })).toEqual({
        ok: false,
        code: "not_found",
      });
      expect(await service.submitMove({ gameId, agentId: agents.black.id, ply: 0, move: "e5" })).toEqual({
        ok: false,
        code: "not_your_turn",
      });
      expect(await service.submitMove({ gameId, agentId: agents.white.id, ply: 5, move: "e4" })).toEqual({
        ok: false,
        code: "stale_ply",
      });
    });

    it("serialises two concurrent moves for the same turn", async () => {
      const gameId = await newGame();
      const [a, b] = await Promise.all([
        service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "e4" }),
        service.submitMove({ gameId, agentId: agents.white.id, ply: 0, move: "d4" }),
      ]);
      const codes = [a, b].map((r) => (r.ok ? "ok" : r.code)).sort();
      expect(codes).toEqual(["ok", "stale_ply"]);
      expect((await service.getSnapshot(gameId))?.ply).toBe(1);
    });
  });

  describe("resign", () => {
    it("ends the game for the resigning side", async () => {
      const gameId = await newGame();
      const r = await service.resign({ gameId, agentId: agents.black.id });
      expect(r).toMatchObject({
        ok: true,
        snapshot: { status: "finished", result: "1-0", termination: "resignation" },
      });
      expect(await service.resign({ gameId, agentId: agents.white.id })).toEqual({
        ok: false,
        code: "game_not_active",
      });
    });

    it("hides the game from strangers", async () => {
      const gameId = await newGame();
      expect(await service.resign({ gameId, agentId: randomUUID() })).toEqual({ ok: false, code: "not_found" });
      expect(await service.resign({ gameId: randomUUID(), agentId: agents.white.id })).toEqual({
        ok: false,
        code: "not_found",
      });
    });
  });

  describe("expireDeadline", () => {
    it("refuses to fire early and reports when to retry", async () => {
      const gameId = await newGame();
      clock = T0 + 60_000;
      expect(await service.expireDeadline({ gameId, ply: 0 })).toEqual({
        ok: false,
        code: "deadline_not_reached",
        fireAt: T0 + 60_000 + NETWORK_GRACE_MS,
      });
    });

    it("aborts a game nobody played", async () => {
      const gameId = await newGame();
      const pub: WireEvent[] = [];
      const offPublic = await bus.subscribeGame(gameId, (e) => pub.push(e));
      clock = T0 + 60_000 + NETWORK_GRACE_MS;
      const r = await service.expireDeadline({ gameId, ply: 0 });
      expect(r).toMatchObject({
        ok: true,
        applied: true,
        snapshot: { status: "aborted", result: "*", termination: "aborted" },
      });
      await waitFor(() => pub.length === 1);
      expect(pub[0]).toMatchObject({ type: "game.end", result: "*", termination: "aborted" });
      await offPublic();
    });

    it("makes the side on move lose after both have played", async () => {
      const gameId = await newGame();
      await play(gameId, "e4");
      await play(gameId, "e5");
      const snapshot = await service.getSnapshot(gameId);
      clock = Date.parse(snapshot?.moveDeadlineAt ?? "") + NETWORK_GRACE_MS;
      const r = await service.expireDeadline({ gameId, ply: 2 });
      expect(r).toMatchObject({
        ok: true,
        applied: true,
        snapshot: { status: "finished", result: "0-1", termination: "timeout" },
      });
    });

    it("ignores a job for an old ply or a finished game", async () => {
      const gameId = await newGame();
      await play(gameId, "e4");
      clock = T0 + 10 * 60_000;
      expect(await service.expireDeadline({ gameId, ply: 0 })).toEqual({
        ok: true,
        applied: false,
        reason: "stale_ply",
      });
      await service.resign({ gameId, agentId: agents.white.id });
      expect(await service.expireDeadline({ gameId, ply: 1 })).toEqual({
        ok: true,
        applied: false,
        reason: "not_active",
      });
      expect(await service.expireDeadline({ gameId: randomUUID(), ply: 0 })).toEqual({
        ok: false,
        code: "not_found",
      });
    });
  });

  describe("rearmActiveDeadlines", () => {
    it("re-schedules a job for every active game", async () => {
      const a = await newGame();
      const b = await newGame();
      await service.resign({ gameId: b, agentId: agents.black.id });
      await queue.obliterate({ force: true });
      expect(await service.rearmActiveDeadlines()).toBe(1);
      expect(await queue.getJob(deadlineJobId(a, 0))).toBeDefined();
      expect(await queue.getJob(deadlineJobId(b, 0))).toBeUndefined();
    });
  });

  describe("activeGameFor and yourTurnFor", () => {
    it("reports the active game and the pending turn per agent", async () => {
      expect(await service.activeGameFor(agents.white.id)).toBeNull();
      expect(await service.yourTurnFor(agents.white.id)).toBeNull();
      const gameId = await newGame();
      expect((await service.activeGameFor(agents.white.id))?.id).toBe(gameId);
      expect((await service.activeGameFor(agents.white.id))?.legalMoves).toHaveLength(20);
      expect((await service.activeGameFor(agents.black.id))?.legalMoves).toBeUndefined();
      const turn = await service.yourTurnFor(agents.white.id);
      expect(turn).toMatchObject({ type: "game.your_turn", gameId, ply: 0, attemptsLeft: 3 });
      expect(await service.yourTurnFor(agents.black.id)).toBeNull();
    });
  });

  describe("reconcile", () => {
    it("re-schedules missing deadline jobs and re-publishes stalled turns", async () => {
      const gameId = await newGame();
      const white: WireEvent[] = [];
      const offWhite = await bus.subscribeAgent(agents.white.id, (e) => white.push(e));
      await queue.obliterate({ force: true });

      clock = T0 + 5_000;
      expect(await service.reconcile({ staleTurnMs: 10_000 })).toEqual({ scanned: 1, republished: 0, rescheduled: 1 });
      expect(await queue.getJob(deadlineJobId(gameId, 0))).toBeDefined();

      clock = T0 + 12_000;
      expect(await service.reconcile({ staleTurnMs: 10_000 })).toEqual({ scanned: 1, republished: 1, rescheduled: 0 });
      await waitFor(() => white.some((e) => e.type === "game.your_turn"));
      const turn = white.find((e) => e.type === "game.your_turn");
      expect(turn).toMatchObject({ gameId, ply: 0 });
      await offWhite();
    });

    it("ignores finished games", async () => {
      const gameId = await newGame();
      await service.resign({ gameId, agentId: agents.black.id });
      clock = T0 + 60_000;
      expect(await service.reconcile({ staleTurnMs: 1 })).toEqual({ scanned: 0, republished: 0, rescheduled: 0 });
    });
  });
});
