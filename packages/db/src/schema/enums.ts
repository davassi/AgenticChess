import { AGENT_STATUSES, COLORS, GAME_STATUSES, ILLEGAL_REASONS, RESULTS, TERMINATIONS } from "@aichess/core/protocol";
import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const agentStatusEnum = pgEnum("agent_status", AGENT_STATUSES);
export const colorEnum = pgEnum("color", COLORS);
export const gameStatusEnum = pgEnum("game_status", GAME_STATUSES);
export const gameResultEnum = pgEnum("game_result", RESULTS);
export const terminationEnum = pgEnum("termination", TERMINATIONS);
export const illegalReasonEnum = pgEnum("illegal_reason", ILLEGAL_REASONS);
