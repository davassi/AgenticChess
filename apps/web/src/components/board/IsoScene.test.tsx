import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IsoScene } from "./IsoScene";

describe("IsoScene", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // jsdom has no 2d context, which is exactly the "no canvas" case the
  // component has to survive without taking the page down with it.
  it("renders a labelled canvas even where no 2d context exists", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<IsoScene kind="board" width={288} height={214} label="An isometric chess board" />);
    const canvas = screen.getByRole("img", { name: "An isometric chess board" });
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas).toHaveAttribute("width", "288");
    expect(warn).toHaveBeenCalled();
  });

  it("unmounts without leaving a resize listener behind", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<IsoScene kind="city" width={320} height={240} label="Architecture" />);
    unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
