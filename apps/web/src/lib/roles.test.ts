import { describe, expect, it } from "vitest";
import { pickPrimaryEmail } from "./github";
import { roleForEmail } from "./roles";

describe("roleForEmail", () => {
  it("promotes only the configured addresses, ignoring case and spacing", () => {
    const list = " Ada@Example.com , grace@example.com ";
    expect(roleForEmail("ada@example.com", list)).toBe("admin");
    expect(roleForEmail("GRACE@EXAMPLE.COM", list)).toBe("admin");
    expect(roleForEmail("mallory@example.com", list)).toBe("user");
  });

  it("promotes nobody when the list is empty", () => {
    expect(roleForEmail("ada@example.com", "")).toBe("user");
    expect(roleForEmail("ada@example.com", "  ,  ")).toBe("user");
    expect(roleForEmail("", "ada@example.com")).toBe("user");
  });
});

describe("pickPrimaryEmail", () => {
  it("takes the primary verified address", () => {
    expect(
      pickPrimaryEmail([
        { email: "alt@example.com", primary: false, verified: true },
        { email: "me@example.com", primary: true, verified: true },
      ]),
    ).toBe("me@example.com");
  });

  it("falls back to any verified address, and never to an unverified one", () => {
    expect(pickPrimaryEmail([{ email: "alt@example.com", primary: false, verified: true }])).toBe("alt@example.com");
    expect(pickPrimaryEmail([{ email: "nope@example.com", primary: true, verified: false }])).toBeNull();
    expect(pickPrimaryEmail([])).toBeNull();
  });
});
