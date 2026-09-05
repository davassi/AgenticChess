import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agentStatusEnum } from "./enums.js";
import { users } from "./users.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    apiKeyPrefix: text("api_key_prefix").notNull(),
    apiKeyHash: text("api_key_hash").notNull(),
    status: agentStatusEnum("status").notNull().default("active"),
    /** The arena's own sparring agent. Excluded from fair-play baselines. */
    isHouse: boolean("is_house").notNull().default(false),
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_api_key_prefix_idx").on(t.apiKeyPrefix), index("agents_owner_idx").on(t.ownerId)],
);

export const agentsRelations = relations(agents, ({ one }) => ({
  owner: one(users, { fields: [agents.ownerId], references: [users.id] }),
}));
