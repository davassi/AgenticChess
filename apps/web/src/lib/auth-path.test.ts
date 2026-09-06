import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTH_BASE_PATH, GITHUB_CALLBACK_PATH } from "./auth-path";

describe("AUTH_BASE_PATH", () => {
  it("stays off the prefix Safe Browsing blocklisted", () => {
    // On 2026-09-05 Google listed the query-less expression
    // "agenticchess.online/api/auth/callback/github" as phishing, which blocked
    // the return leg of every sign-in. Safe Browsing matches path prefixes, so
    // living anywhere else keeps registration reachable while the review runs.
    expect(GITHUB_CALLBACK_PATH.startsWith("/api/auth/")).toBe(false);
    expect(AUTH_BASE_PATH.startsWith("/")).toBe(true);
    expect(AUTH_BASE_PATH.endsWith("/")).toBe(false);
    expect(GITHUB_CALLBACK_PATH).toBe(`${AUTH_BASE_PATH}/callback/github`);
  });

  it("has its route handler where the base path says it is", () => {
    // Auth.js takes the base path from the config, Next mounts the handler from
    // the directory name, and nothing ties the two together. Let them drift and
    // every callback answers 404, visible only in a real OAuth round trip.
    //
    // Built from path segments, not `new URL(..., import.meta.url)`: Vite
    // rewrites that pattern into an asset reference at transform time, and a
    // computed path resolves to the literal string "undefined".
    const here = dirname(fileURLToPath(import.meta.url));
    const route = join(here, "..", "app", ...AUTH_BASE_PATH.split("/").filter(Boolean), "[...nextauth]", "route.ts");
    expect(existsSync(route)).toBe(true);
  });
});
