import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { applyUci, startingPosition } from "@/lib/position";
import { Board2D } from "./Board2D";
import { MoveList } from "./MoveList";

const MOVES = [
  { ply: 1, color: "white" as const, san: "e4", thinkTimeMs: 8_100 },
  { ply: 2, color: "black" as const, san: "e5", thinkTimeMs: 1_400 },
];

describe("Board2D", () => {
  it("draws sixty-four squares and thirty-two pieces", () => {
    const { container } = render(<Board2D position={startingPosition()} lastMove={null} />);
    expect(container.querySelectorAll(".sq")).toHaveLength(64);
    expect(container.querySelectorAll(".piece")).toHaveLength(32);
    expect(container.querySelectorAll(".sq--light")).toHaveLength(32);
  });

  it("keeps the same node for a piece that moved, which is what makes it slide", () => {
    const { container, rerender } = render(<Board2D position={startingPosition()} lastMove={null} />);
    const before = container.querySelector('[data-piece-id="e2"]');
    rerender(<Board2D position={applyUci(startingPosition(), "e2e4")} lastMove={{ from: "e2", to: "e4" }} />);
    const after = container.querySelector('[data-piece-id="e2"]');
    expect(after).toBe(before);
    expect(after?.getAttribute("style")).toContain("translate(400%, 400%)");
    expect(container.querySelectorAll(".mark--last")).toHaveLength(2);
  });
});

describe("MoveList", () => {
  it("marks the selected ply and reports clicks", async () => {
    const onSelect = vi.fn();
    render(<MoveList moves={MOVES} selectedPly={2} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /e5/ })).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: /e4/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("groups a move pair into one row and keeps think time in the tooltip", () => {
    const { container } = render(<MoveList moves={MOVES} selectedPly={2} onSelect={() => undefined} />);
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector(".num")).toHaveTextContent("1.");
    expect(screen.getByRole("button", { name: "e4" })).toHaveAttribute("title", "8.1 s of thinking");
  });
});
