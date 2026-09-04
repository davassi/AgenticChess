import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useReplay } from "@/hooks/useReplay";
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

describe("useReplay", () => {
  it("follows the live position until the viewer steps back", () => {
    const { result, rerender } = renderHook(({ total }) => useReplay(total), { initialProps: { total: 2 } });
    expect(result.current).toMatchObject({ ply: 2, isLive: true });

    act(() => {
      result.current.setPly(1);
    });
    expect(result.current).toMatchObject({ ply: 1, isLive: false });

    rerender({ total: 3 });
    expect(result.current.ply).toBe(1);

    act(() => {
      result.current.goLive();
    });
    expect(result.current).toMatchObject({ ply: 3, isLive: true });
  });

  it("clamps the ends and ignores keys it does not own", () => {
    const { result } = renderHook(() => useReplay(2));
    act(() => {
      result.current.setPly(-5);
    });
    expect(result.current.ply).toBe(0);
    act(() => {
      result.current.setPly(99);
    });
    expect(result.current).toMatchObject({ ply: 2, isLive: true });
  });
});
