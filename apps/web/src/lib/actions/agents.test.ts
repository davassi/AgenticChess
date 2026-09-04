import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
const runtime = vi.hoisted(() => ({
  createAgentForOwner: vi.fn(),
  rotateAgentKey: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  currentUser: async () => session.user,
  requireUser: async () => {
    if (session.user === null) throw new Error("redirect");
    return session.user;
  },
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@aichess/runtime/agents", () => runtime);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createAgentAction, rotateKeyAction } = await import("./agents");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const VALID = {
  name: "Rook and Roll",
  slug: "rook-and-roll",
  description: "Loves rook lifts.",
  modelProvider: "Google",
  modelName: "gemma-3-27b",
};

describe("dashboard actions", () => {
  beforeEach(() => {
    session.user = { id: "11111111-1111-4111-8111-111111111111" };
    runtime.createAgentForOwner.mockReset();
    runtime.rotateAgentKey.mockReset();
  });

  it("refuses to run without a session", async () => {
    session.user = null;
    await expect(createAgentAction({ status: "idle" }, form(VALID))).rejects.toThrow();
    expect(runtime.createAgentForOwner).not.toHaveBeenCalled();
  });

  it("reports field errors instead of calling the database", async () => {
    const state = await createAgentAction({ status: "idle" }, form({ ...VALID, name: "ab", slug: "Nope!" }));
    expect(state.status).toBe("error");
    expect(state.status === "error" ? state.fields : {}).toMatchObject({
      name: expect.any(String),
      slug: expect.any(String),
    });
    expect(runtime.createAgentForOwner).not.toHaveBeenCalled();
  });

  it("fills the slug from the name when the field is left empty", async () => {
    runtime.createAgentForOwner.mockResolvedValue({
      ok: true,
      key: "ac_abcdefghi",
      agent: { agent: { slug: "rook-and-roll" } },
    });
    const state = await createAgentAction({ status: "idle" }, form({ ...VALID, slug: "" }));
    expect(runtime.createAgentForOwner).toHaveBeenCalledWith(
      expect.anything(),
      session.user?.id,
      expect.objectContaining({ slug: "rook-and-roll" }),
    );
    expect(state).toMatchObject({ status: "created", key: "ac_abcdefghi", slug: "rook-and-roll" });
  });

  it("blames the name when the name is all the form has", async () => {
    // "AI!" is a valid name and slugifies to two characters. The form has no
    // slug field, so the error has to land somewhere the visitor can act on.
    const state = await createAgentAction({ status: "idle" }, form({ ...VALID, name: "AI!", slug: "" }));
    expect(state.status).toBe("error");
    const fields = state.status === "error" ? (state.fields ?? {}) : {};
    expect(fields["name"]).toMatch(/three letters or digits/);
    expect(fields["slug"]).toBeUndefined();
    expect(runtime.createAgentForOwner).not.toHaveBeenCalled();
  });

  it("answers a malformed agent id instead of letting Postgres raise on it", async () => {
    const state = await rotateKeyAction({ status: "idle" }, form({ agentId: "not-a-uuid", slug: "rook-and-roll" }));
    expect(state).toEqual({ status: "error", message: "That agent is not yours, or no longer exists." });
    expect(runtime.rotateAgentKey).not.toHaveBeenCalled();
  });

  it("turns a taken slug and a full account into readable messages", async () => {
    runtime.createAgentForOwner.mockResolvedValue({ ok: false, code: "slug_taken" });
    expect(await createAgentAction({ status: "idle" }, form(VALID))).toMatchObject({
      status: "error",
      fields: { slug: expect.stringMatching(/taken/i) },
    });

    runtime.createAgentForOwner.mockResolvedValue({ ok: false, code: "agent_limit_reached" });
    expect(await createAgentAction({ status: "idle" }, form(VALID))).toMatchObject({
      status: "error",
      message: expect.stringMatching(/limit/i),
    });
  });

  it("rotates a key and never rotates one it does not own", async () => {
    runtime.rotateAgentKey.mockResolvedValue({ ok: true, key: "ac_newkey" });
    expect(
      await rotateKeyAction({ status: "idle" }, form({ agentId: "22222222-2222-4222-8222-222222222222", slug: "x" })),
    ).toMatchObject({ status: "rotated", key: "ac_newkey" });

    runtime.rotateAgentKey.mockResolvedValue({ ok: false, code: "not_found" });
    expect(
      await rotateKeyAction({ status: "idle" }, form({ agentId: "22222222-2222-4222-8222-222222222222", slug: "x" })),
    ).toMatchObject({ status: "error" });
  });
});
