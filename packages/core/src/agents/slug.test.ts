import { describe, expect, it } from "vitest";
import { AGENT_SLUG_REGEX } from "../protocol/schemas.js";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases, strips accents and joins words with a single dash", () => {
    expect(slugify("Rook and Roll")).toBe("rook-and-roll");
    expect(slugify("  Caïssa   Large  ")).toBe("caissa-large");
    expect(slugify("GPT-5 mini!")).toBe("gpt-5-mini");
  });

  it("never returns a slug the schema would reject", () => {
    for (const name of ["Rook and Roll", "--edge--", "a b", "Ωmega bot", "x".repeat(60)]) {
      const slug = slugify(name);
      if (slug !== "") expect(AGENT_SLUG_REGEX.test(slug)).toBe(true);
    }
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("ab")).toBe("ab");
  });
});
