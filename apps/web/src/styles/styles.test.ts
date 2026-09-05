import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const STYLES = join(SRC, "styles");

/** The sheets `app/layout.tsx` imports, so every route carries them. */
const GLOBAL = ["landing.css", "arena.css"];

/**
 * A shared component and the sheet its rules live in.
 *
 * Sheets here are imported per route, so a component rendered on a route that
 * does not import its sheet is simply unstyled there - with correct markup, no
 * error, and nothing else to notice it. The fix is for the component to import
 * its own sheet, and this is the list of components that have had to.
 */
const COMPONENT_SHEETS: ReadonlyArray<readonly [string, string]> = [
  ["components/games/GameRow.tsx", "games.css"],
  ["components/leaderboard/Standings.tsx", "leaderboard.css"],
];

function sheets(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(STYLES)
      .filter((name) => name.endsWith(".css"))
      .map((name) => [name, readFileSync(join(STYLES, name), "utf8")]),
  );
}

describe("stylesheets", () => {
  // Used by four routes and by two components rendered on a fifth. The only
  // place it cannot go missing is a globally imported sheet - and a rule that
  // hides a label from sight but not from a screen reader is wrong on any page
  // that lacks it.
  it("defines .visually-hidden once, in a sheet every route loads", () => {
    const css = sheets();
    const where = Object.keys(css).filter((name) => /^\.visually-hidden[\s,{]/m.test(css[name] ?? ""));
    expect(where).toHaveLength(1);
    expect(GLOBAL).toContain(where[0]);
  });

  it.each(COMPONENT_SHEETS)("%s carries its own stylesheet", (component, sheet) => {
    const source = readFileSync(join(SRC, component), "utf8");
    expect(source).toContain(`import "@/styles/${sheet}"`);
  });
});
