import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPrimaryEmail, githubUser, pickPrimaryEmail } from "./github";

const PROFILE = {
  id: 4210,
  login: "opusbot",
  name: "Opus Bot",
  avatar_url: "https://avatars.test/opusbot.png",
};

function stubEmails(entries: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(entries), { status: ok ? 200 : 403 })),
  );
}

describe("pickPrimaryEmail", () => {
  it("prefers the verified primary address", () => {
    expect(
      pickPrimaryEmail([
        { email: "old@test.dev", primary: false, verified: true },
        { email: "primary@test.dev", primary: true, verified: true },
      ]),
    ).toBe("primary@test.dev");
  });

  it("never returns an unverified address, even when it is the primary one", () => {
    expect(pickPrimaryEmail([{ email: "spoofed@test.dev", primary: true, verified: false }])).toBeNull();
  });
});

describe("fetchPrimaryEmail", () => {
  it("reads the verified address from GitHub", async () => {
    stubEmails([{ email: "primary@test.dev", primary: true, verified: true }]);
    await expect(fetchPrimaryEmail("token")).resolves.toBe("primary@test.dev");
  });

  it("gives nothing when GitHub refuses or answers with something else", async () => {
    stubEmails([{ email: "primary@test.dev", primary: true, verified: true }], false);
    await expect(fetchPrimaryEmail("token")).resolves.toBeNull();
    stubEmails({ message: "Bad credentials" });
    await expect(fetchPrimaryEmail("token")).resolves.toBeNull();
  });
});

describe("githubUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the address from /user/emails, never the public profile one", async () => {
    // GitHub shows a public profile address whether or not it is verified, and
    // ADMIN_EMAILS is matched on whatever we store here.
    stubEmails([{ email: "verified@test.dev", primary: true, verified: true }]);
    const user = await githubUser({ ...PROFILE, email: "admin@aichess.dev" }, "token");
    expect(user.email).toBe("verified@test.dev");
    expect(user).toMatchObject({ id: "4210", name: "Opus Bot", image: PROFILE.avatar_url });
  });

  it("refuses the sign-in when no verified address comes back", async () => {
    stubEmails([{ email: "admin@aichess.dev", primary: true, verified: false }]);
    await expect(githubUser({ ...PROFILE, email: "admin@aichess.dev" }, "token")).rejects.toThrow(/verified email/);
  });

  it("refuses the sign-in when the scope gave us no token to check with", async () => {
    await expect(githubUser(PROFILE, undefined)).rejects.toThrow(/verified email/);
  });

  it("falls back to the login when the account has no display name", async () => {
    stubEmails([{ email: "verified@test.dev", primary: true, verified: true }]);
    const user = await githubUser({ ...PROFILE, name: null }, "token");
    expect(user.name).toBe("opusbot");
  });
});
