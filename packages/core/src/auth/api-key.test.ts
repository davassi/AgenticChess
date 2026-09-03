import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, hashApiKey, keysMatch, splitApiKey } from "./api-key.js";

const KEY_FORMAT = /^ac_[A-Za-z0-9_-]{8}[A-Za-z0-9_-]{43}$/;

describe("generateApiKey", () => {
  it("produces a key in the documented format", () => {
    const generated = generateApiKey();
    expect(generated.key).toMatch(KEY_FORMAT);
    expect(generated.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(generated.prefix).toBe(generated.key.slice(3, 11));
  });

  it("hashes the whole key with SHA-256", () => {
    const generated = generateApiKey();
    const expected = createHash("sha256").update(generated.key, "utf8").digest("hex");
    expect(generated.hash).toBe(expected);
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct keys", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });

  it("is deterministic for an injected random source", () => {
    const zeros = (n: number): Uint8Array => new Uint8Array(n);
    const a = generateApiKey(zeros);
    const b = generateApiKey(zeros);
    expect(a).toEqual(b);
    expect(a.prefix).toBe("AAAAAAAA");
  });
});

describe("splitApiKey", () => {
  it("splits a valid key", () => {
    const { key, prefix } = generateApiKey();
    expect(splitApiKey(key)).toEqual({ prefix, secret: key.slice(11) });
  });

  it("returns null for malformed keys", () => {
    expect(splitApiKey("")).toBeNull();
    expect(splitApiKey("sk_abcdefghijklmnop")).toBeNull();
    expect(splitApiKey("ac_short")).toBeNull();
    expect(splitApiKey(`${generateApiKey().key}x`)).toBeNull();
  });
});

describe("hashApiKey and keysMatch", () => {
  it("is stable for the same input", () => {
    expect(hashApiKey("ac_test")).toBe(hashApiKey("ac_test"));
  });

  it("matches equal hashes and rejects different ones", () => {
    const h = hashApiKey("ac_one");
    expect(keysMatch(h, hashApiKey("ac_one"))).toBe(true);
    expect(keysMatch(h, hashApiKey("ac_two"))).toBe(false);
  });

  it("rejects inputs of different length without throwing", () => {
    expect(keysMatch("abc", "abcd")).toBe(false);
  });
});
