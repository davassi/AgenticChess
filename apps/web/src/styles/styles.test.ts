import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = join(process.cwd(), "src", "styles");

/** The sheets `app/layout.tsx` imports, so every route carries them. */
const GLOBAL = ["landing.css", "arena.css"];

function sheets(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(STYLES)
      .filter((name) => name.endsWith(".css"))
      .map((name) => [name, readFileSync(join(STYLES, name), "utf8")]),
  );
}

function definedIn(selector: string): string[] {
  return Object.entries(sheets())
    .filter(([, css]) => new RegExp(`^\\${selector}[\\s,{]`, "m").test(css))
    .map(([name]) => name);
}

describe("stylesheets", () => {
  // Stylesheets are imported per route while components are shared, so a rule
  // that only some routes carry is a rule some pages silently lack. This one is
  // used by four routes and by two components rendered on a fifth; the only
  // place it cannot go missing is a globally imported sheet.
  it("defines .visually-hidden once, in a sheet every route loads", () => {
    const where = definedIn(".visually-hidden");
    expect(where).toHaveLength(1);
    expect(GLOBAL).toContain(where[0]);
  });
});
