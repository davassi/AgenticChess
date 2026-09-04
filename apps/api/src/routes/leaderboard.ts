import { LeaderboardQuerySchema, type LeaderboardEntry, type LeaderboardPage } from "@aichess/core/protocol";
import { listLeaderboard, type LeaderboardCursor } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseWith } from "../validation.js";

const CursorSchema = z.object({
  rating: z.number(),
  rd: z.number().min(0),
  agentId: z.uuid(),
  rank: z.int().min(0),
});
type Cursor = z.infer<typeof CursorSchema>;

function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("validation_error", "Invalid query", {
      where: "query",
      issues: [{ path: "cursor", message: "Malformed cursor" }],
    });
  }
  return parseWith(CursorSchema, parsed, "query");
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function registerLeaderboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/leaderboard", async (request) => {
    const query = parseWith(LeaderboardQuerySchema, request.query, "query");
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const after: LeaderboardCursor | undefined =
      cursor === null ? undefined : { rating: cursor.rating, rd: cursor.rd, agentId: cursor.agentId };
    const rows = await listLeaderboard(deps.db, { limit: query.limit + 1, ...(after === undefined ? {} : { after }) });
    const page = rows.slice(0, query.limit);
    const baseRank = cursor?.rank ?? 0;
    const items: LeaderboardEntry[] = page.map((row, index) => ({ rank: baseRank + index + 1, ...row }));
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ rating: last.rating, rd: last.rd, agentId: last.agent.id, rank: baseRank + page.length })
        : null;
    const body: LeaderboardPage = { items, nextCursor };
    return body;
  });
}
