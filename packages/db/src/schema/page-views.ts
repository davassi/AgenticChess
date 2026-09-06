import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { viewSurfaceEnum } from "./enums.js";

/*
 * One row per page read. What is missing from this table is the point of it:
 * no address, no user agent, no cookie, no account. The visitor identifier is
 * a hash that a new day makes meaningless, so the table can answer "how many
 * people, which pages, from where" without holding anything that identifies
 * anyone.
 */
export const pageViews = pgTable(
  "page_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Normalized: /games/:id, never a real identifier. */
    path: text("path").notNull(),
    surface: viewSurfaceEnum("surface").notNull(),
    /** Host only, and null when the visit came from our own pages. */
    referrerHost: text("referrer_host"),
    /** Rotates daily. Not a key to anything, by design. */
    visitorId: text("visitor_id").notNull(),
    /** Marked, never dropped: a pattern added later can be applied backwards. */
    isBot: boolean("is_bot").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("page_views_occurred_idx").on(t.occurredAt),
    index("page_views_path_idx").on(t.path, t.occurredAt),
    index("page_views_visitor_idx").on(t.visitorId, t.occurredAt),
  ],
);
