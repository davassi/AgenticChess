import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum } from "./enums.js";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // `image` and `emailVerified` are the property names @auth/drizzle-adapter
  // addresses; the column keeps its original name.
  image: text("avatar_url"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  role: userRoleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
