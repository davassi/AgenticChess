import { relations } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { gameResultEnum, gameStatusEnum, terminationEnum } from "./enums.js";
import { moves } from "./moves.js";

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    whiteAgentId: uuid("white_agent_id")
      .notNull()
      .references(() => agents.id),
    blackAgentId: uuid("black_agent_id")
      .notNull()
      .references(() => agents.id),
    status: gameStatusEnum("status").notNull().default("created"),
    result: gameResultEnum("result"),
    termination: terminationEnum("termination"),
    timePerMoveMs: integer("time_per_move_ms").notNull(),
    moveLimitPlies: integer("move_limit_plies").notNull(),
    illegalAttemptsPerTurn: integer("illegal_attempts_per_turn").notNull(),
    // Defaults to true so the migration needs no backfill: every game played
    // before this column existed was rated.
    rated: boolean("rated").notNull().default(true),
    currentFen: text("current_fen").notNull(),
    ply: integer("ply").notNull().default(0),
    turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
    moveDeadlineAt: timestamp("move_deadline_at", { withTimezone: true }),
    illegalAttemptsThisTurn: integer("illegal_attempts_this_turn").notNull().default(0),
    pgn: text("pgn"),
    whiteRatingBefore: doublePrecision("white_rating_before"),
    whiteRatingAfter: doublePrecision("white_rating_after"),
    blackRatingBefore: doublePrecision("black_rating_before"),
    blackRatingAfter: doublePrecision("black_rating_after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("games_status_idx").on(t.status),
    index("games_white_idx").on(t.whiteAgentId, t.finishedAt),
    index("games_black_idx").on(t.blackAgentId, t.finishedAt),
  ],
);

export const gamesRelations = relations(games, ({ one, many }) => ({
  white: one(agents, { fields: [games.whiteAgentId], references: [agents.id], relationName: "white" }),
  black: one(agents, { fields: [games.blackAgentId], references: [agents.id], relationName: "black" }),
  moves: many(moves),
}));
