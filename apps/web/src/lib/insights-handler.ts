import { keysMatch } from "@aichess/core";
import type { PageViewRange, PageViewStats } from "@aichess/db";
import { parseDays } from "./analytics";

export interface InsightsDeps {
  stats: (range: PageViewRange) => Promise<PageViewStats>;
  /** Null means no token was configured, and the endpoint stays shut. */
  token: string | null;
  now: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/**
 * Reading the arena's own traffic, for a terminal on another machine. Guarded
 * by a shared token rather than a session: this is meant to be reached with
 * curl, and there is no page behind it to sign in from.
 */
export async function handleInsights(request: Request, deps: InsightsDeps): Promise<Response> {
  if (deps.token === null) {
    // An honest 503 beats a 401 that would send someone hunting for a token
    // that was never set.
    return json({ error: "Statistics are not configured on this deployment" }, 503);
  }

  const provided = request.headers.get("x-analytics-token");
  // keysMatch compares in constant time and returns false on a length mismatch,
  // so a wrong guess reveals nothing about the real token.
  if (provided === null || !keysMatch(provided, deps.token)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const days = parseDays(new URL(request.url).searchParams.get("days"));
  if (days === null) {
    return json({ error: "days must be a whole number between 1 and 365" }, 400);
  }

  const to = deps.now();
  const stats = await deps.stats({ from: new Date(to.getTime() - days * DAY_MS), to });
  return json(
    { days, from: new Date(to.getTime() - days * DAY_MS).toISOString(), to: to.toISOString(), ...stats },
    200,
  );
}
