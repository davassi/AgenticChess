import { randomUUID } from "node:crypto";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, sessions, users, verificationTokens } from "./schema/index.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`the adapter does not implement ${name}`);
  return value;
}

describe("Auth.js drizzle adapter against our schema", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  function adapterFor(): ReturnType<typeof DrizzleAdapter> {
    return DrizzleAdapter(tdb.db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    });
  }

  it("creates a user, links a GitHub account and round-trips a session", async () => {
    const adapter = adapterFor();

    const created = await required(
      adapter.createUser,
      "createUser",
    )({
      id: randomUUID(),
      name: "Ada",
      email: "ada@example.com",
      emailVerified: null,
      image: "https://example.com/ada.png",
    });
    expect(created.email).toBe("ada@example.com");

    await required(
      adapter.linkAccount,
      "linkAccount",
    )({
      userId: created.id,
      type: "oauth",
      provider: "github",
      providerAccountId: "42",
      access_token: "token",
      scope: "read:user user:email",
    });
    const byAccount = await required(
      adapter.getUserByAccount,
      "getUserByAccount",
    )({
      provider: "github",
      providerAccountId: "42",
    });
    expect(byAccount?.id).toBe(created.id);

    const expires = new Date(Date.now() + 3_600_000);
    await required(
      adapter.createSession,
      "createSession",
    )({
      sessionToken: "session-token",
      userId: created.id,
      expires,
    });
    const found = await required(adapter.getSessionAndUser, "getSessionAndUser")("session-token");
    expect(found?.user.email).toBe("ada@example.com");
    expect(found?.session.expires.getTime()).toBe(expires.getTime());

    await required(adapter.deleteSession, "deleteSession")("session-token");
    expect(await required(adapter.getSessionAndUser, "getSessionAndUser")("session-token")).toBeNull();
  });

  it("reads the image column that the database still calls avatar_url", async () => {
    const adapter = adapterFor();
    const created = await required(
      adapter.createUser,
      "createUser",
    )({
      id: randomUUID(),
      name: "Grace",
      email: "grace@example.com",
      emailVerified: null,
      image: "https://example.com/grace.png",
    });
    const [row] = await tdb.db.select().from(users);
    expect(row?.image).toBe("https://example.com/grace.png");
    expect(await required(adapter.getUser, "getUser")(created.id)).toMatchObject({ name: "Grace" });
  });
});
