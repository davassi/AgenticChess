import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const BASE = {
  API_PUBLIC_URL: "https://api.example.com",
  DATABASE_URL: "postgres://aichess:aichess@localhost:5432/aichess",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  AUTH_GITHUB_ID: "id",
  AUTH_GITHUB_SECRET: "secret",
};

describe("web configuration", () => {
  it("falls back to the public URL for server-side fetches", () => {
    const env = loadEnv(BASE);
    expect(env.apiPublicUrl).toBe("https://api.example.com");
    expect(env.apiInternalUrl).toBe("https://api.example.com");
    expect(env.adminEmails).toBe("");
  });

  it("keeps a separate internal URL when one is given", () => {
    expect(loadEnv({ ...BASE, API_INTERNAL_URL: "http://api:3001" }).apiInternalUrl).toBe("http://api:3001");
  });

  it("drops a trailing slash so paths never double up", () => {
    expect(loadEnv({ ...BASE, API_PUBLIC_URL: "https://api.example.com/" }).apiPublicUrl).toBe(
      "https://api.example.com",
    );
  });

  it("fails loudly when the public URL is missing or malformed", () => {
    expect(() => loadEnv({ ...BASE, API_PUBLIC_URL: undefined })).toThrow(/API_PUBLIC_URL/);
    expect(() => loadEnv({ ...BASE, API_PUBLIC_URL: "not-a-url" })).toThrow(/API_PUBLIC_URL/);
  });

  it("refuses a weak session secret, the one mistake that silently costs sessions", () => {
    expect(() => loadEnv({ ...BASE, AUTH_SECRET: "too-short" })).toThrow(/AUTH_SECRET/);
    expect(() => loadEnv({ ...BASE, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/);
  });

  it("requires the database and the GitHub app", () => {
    expect(() => loadEnv({ ...BASE, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...BASE, AUTH_GITHUB_ID: undefined })).toThrow(/AUTH_GITHUB_ID/);
  });
});
