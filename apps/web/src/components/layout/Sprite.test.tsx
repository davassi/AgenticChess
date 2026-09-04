import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sprite } from "./Sprite";

describe("Sprite", () => {
  it("labels a sprite that carries meaning", () => {
    render(<Sprite name="king" palette="gold" scale={2} label="opusbot plays white" />);
    const svg = screen.getByRole("img", { name: "opusbot plays white" });
    // 13 columns of artwork plus the one-pixel outline on each side, at scale 2.
    expect(svg.getAttribute("width")).toBe(String((13 + 2) * 2));
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("hides a decorative sprite from assistive technology", () => {
    const { container } = render(<Sprite name="moon" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing for an unknown sprite instead of throwing", () => {
    const { container } = render(<Sprite name={"nope" as never} />);
    expect(container.firstChild).toBeNull();
  });
});
