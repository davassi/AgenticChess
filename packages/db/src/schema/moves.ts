import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { colorEnum, illegalReasonEnum } from "./enums.js";
import { games } from "./games.js";

export const moves = pgTable(
  "moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ply: integer("ply").notNull(),
    color: colorEnum("color").notNull(),
    san: text("san").notNull(),
    uci: text("uci").notNull(),
    fenAfter: text("fen_after").notNull(),
    comment: text("comment"),
    thinkTimeMs: integer("think_time_ms").notNull(),
    illegalAttemptsBefore: integer("illegal_attempts_before").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("moves_game_ply_idx").on(t.gameId, t.ply)],
);

export const movesRelations = relations(moves, ({ one }) => ({
  game: one(games, { fields: [moves.gameId], references: [games.id] }),
}));

export const moveAttempts = pgTable(
  "move_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    ply: integer("ply").notNull(),
    submitted: text("submitted").notNull(),
    reason: illegalReasonEnum("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("move_attempts_game_idx").on(t.gameId), index("move_attempts_agent_idx").on(t.agentId)],
);
