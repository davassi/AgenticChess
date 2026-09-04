import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sky, starShadows } from "./Sky";

describe("Sky", () => {
  it("draws the same sky for the same seed", () => {
    expect(starShadows(7)).toBe(starShadows(7));
    expect(starShadows(7)).not.toBe(starShadows(8));
    expect(starShadows(7).split(",")).toHaveLength(160);
  });

  // Asserted on the server output: jsdom's CSS parser drops a box-shadow in
  // viewport units, and the server HTML is what actually reaches the browser.
  it("renders the stars inline so the browser runs no script for them", () => {
    const html = renderToStaticMarkup(<Sky />);
    expect(html).toContain('class="stars"');
    expect(html).toContain("box-shadow");
    expect(html).toContain("vw");
    expect(html).not.toContain("<script");
  });
});
