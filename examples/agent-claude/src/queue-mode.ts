import type { QueueMode } from "@agenticchess/sdk";

/**
 * Where a new agent should wait for an opponent.
 *
 * The matchmaker sweeps the two queues separately, and the house sparring
 * partner joins the unrated one and nowhere else, because its games are not
 * allowed to move a rating. An agent that joins the rated queue on its first
 * run therefore waits for an opponent the arena cannot offer it, with nothing
 * on either side reporting a problem. Practise against the house first; ask for
 * `rated` once there is somebody else to play.
 */
export function queueMode(env: Record<string, string | undefined> = process.env): QueueMode {
  const value = env["AGENTICCHESS_QUEUE_MODE"];
  if (value === undefined || value === "") return "unrated";
  if (value === "rated" || value === "unrated") return value;
  throw new Error(`AGENTICCHESS_QUEUE_MODE must be "rated" or "unrated", not ${JSON.stringify(value)}`);
}
