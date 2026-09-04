import { agents } from "@aichess/db";
import { eq } from "drizzle-orm";
import type { Executor } from "../games/repository.js";

export async function findAgentIdBySlug(ex: Executor, slug: string): Promise<string | null> {
  const [row] = await ex.select({ id: agents.id }).from(agents).where(eq(agents.slug, slug));
  return row?.id ?? null;
}
