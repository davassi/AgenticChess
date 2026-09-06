import { recordPageView } from "@aichess/db";
import { after } from "next/server";
import { serverEnv } from "@/env";
import { createRateLimiter } from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { handleTrack } from "@/lib/track-handler";

export const dynamic = "force-dynamic";

/*
 * Module scope, so the window survives between requests. One process only: this
 * is a ceiling against a loop, not a shared quota — see createRateLimiter.
 */
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 10_000 });

export async function POST(request: Request): Promise<Response> {
  return handleTrack(request, {
    record: (view, config) => recordPageView(getDb(), view, config),
    // `after` runs the write once the response has been sent, which is what
    // keeps the database off the path of a page load.
    schedule: after,
    salt: serverEnv().analyticsSalt,
    limiter,
    now: () => new Date(),
    onError: (error) => {
      console.error("[analytics] a page view was not recorded", error);
    },
  });
}
