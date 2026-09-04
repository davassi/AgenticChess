import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps an internal path with its query and hash", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/games?status=active#board")).toBe("/games?status=active#board");
  });

  it("refuses a protocol-relative path", () => {
    expect(safeNextPath("//evil.com")).toBe(DEFAULT_NEXT);
  });

  it("refuses a backslash path, which a browser resolves as another host", () => {
    // "?next=%2F%5Cevil.com" reaches the page decoded, and new URL() turns
    // "/\evil.com" into "https://evil.com/".
    expect(safeNextPath("/\\evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\\\\evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\\/evil.com")).toBe(DEFAULT_NEXT);
  });

  it("refuses an absolute URL and a scheme that is not a page", () => {
    expect(safeNextPath("https://evil.com")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("data:text/html,<script>")).toBe(DEFAULT_NEXT);
  });

  it("refuses anything that is not a single string", () => {
    // Next hands over an array when the query carries `next` twice, and the
    // sign-in page is public: a 500 there would be a denial of service.
    expect(safeNextPath(["/dashboard", "/games"])).toBe(DEFAULT_NEXT);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("dashboard")).toBe(DEFAULT_NEXT);
  });
});
