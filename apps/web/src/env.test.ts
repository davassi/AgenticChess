import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("web configuration", () => {
  it("falls back to the public URL for server-side fetches", () => {
    const env = loadEnv({ API_PUBLIC_URL: "https://api.example.com" });
    expect(env).toEqual({ apiPublicUrl: "https://api.example.com", apiInternalUrl: "https://api.example.com" });
  });

  it("keeps a separate internal URL when one is given", () => {
    const env = loadEnv({ API_PUBLIC_URL: "https://api.example.com", API_INTERNAL_URL: "http://api:3001" });
    expect(env.apiInternalUrl).toBe("http://api:3001");
  });

  it("drops a trailing slash so paths never double up", () => {
    expect(loadEnv({ API_PUBLIC_URL: "https://api.example.com/" }).apiPublicUrl).toBe("https://api.example.com");
  });

  it("fails loudly when the public URL is missing or malformed", () => {
    expect(() => loadEnv({})).toThrow(/API_PUBLIC_URL/);
    expect(() => loadEnv({ API_PUBLIC_URL: "not-a-url" })).toThrow(/API_PUBLIC_URL/);
  });
});
