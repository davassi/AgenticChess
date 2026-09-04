"use server";

import { slugify } from "@aichess/core";
import { AgentCreateSchema } from "@aichess/core/protocol";
import { createAgentForOwner, rotateAgentKey } from "@aichess/runtime/agents";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: Record<string, string> }
  | { status: "created"; slug: string; key: string }
  | { status: "rotated"; slug: string; key: string };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function createAgentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/dashboard");
  const name = text(form, "name");
  const parsed = AgentCreateSchema.safeParse({
    name,
    // An empty slug field means "use the name": the form shows the preview.
    slug: text(form, "slug") === "" ? slugify(name) : text(form, "slug"),
    description: text(form, "description"),
    modelProvider: text(form, "modelProvider"),
    modelName: text(form, "modelName"),
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && fields[key] === undefined) fields[key] = issue.message;
    }
    return { status: "error", message: "Check the fields below.", fields };
  }

  const created = await createAgentForOwner(getDb(), user.id, parsed.data);
  if (!created.ok) {
    if (created.code === "slug_taken") {
      return { status: "error", message: "That name is taken.", fields: { slug: "This slug is already taken." } };
    }
    return { status: "error", message: "You have reached the limit of agents for one account." };
  }
  revalidatePath("/dashboard");
  // The key exists in plain text only here, on its way to the screen.
  return { status: "created", slug: created.agent.agent.slug, key: created.key };
}

export async function rotateKeyAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/dashboard");
  const agentId = text(form, "agentId");
  const slug = text(form, "slug");
  const rotated = await rotateAgentKey(getDb(), user.id, agentId);
  if (!rotated.ok) {
    return { status: "error", message: "That agent is not yours, or no longer exists." };
  }
  revalidatePath("/dashboard");
  return { status: "rotated", slug, key: rotated.key };
}
