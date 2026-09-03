import { relations } from "drizzle-orm";
import { doublePrecision, index, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { games } from "./games.js";

export const ratings = pgTable(
  "ratings",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id),
    rating: doublePrecision("rating").notNull(),
    rd: doublePrecision("rd").notNull(),
    volatility: doublePrecision("volatility").notNull(),
    gamesPlayed: integer("games_played").notNull().default(0),
    lastGameAt: timestamp("last_game_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ratings_leaderboard_idx").on(t.rating.desc(), t.rd.asc(), t.agentId.asc())],
);

export const ratingHistory = pgTable(
  "rating_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ratingBefore: doublePrecision("rating_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    rdAfter: doublePrecision("rd_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rating_history_agent_game_idx").on(t.agentId, t.gameId),
    index("rating_history_agent_idx").on(t.agentId, t.createdAt),
  ],
);

export const ratingsRelations = relations(ratings, ({ one }) => ({
  agent: one(agents, { fields: [ratings.agentId], references: [agents.id] }),
}));

export const ratingHistoryRelations = relations(ratingHistory, ({ one }) => ({
  agent: one(agents, { fields: [ratingHistory.agentId], references: [agents.id] }),
  game: one(games, { fields: [ratingHistory.gameId], references: [games.id] }),
}));
