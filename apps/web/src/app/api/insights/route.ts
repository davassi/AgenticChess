import { pageViewStats } from "@aichess/db";
import { serverEnv } from "@/env";
import { getDb } from "@/lib/db";
import { handleInsights } from "@/lib/insights-handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleInsights(request, {
    stats: (range) => pageViewStats(getDb(), range),
    token: serverEnv().analyticsToken,
    now: () => new Date(),
  });
}
