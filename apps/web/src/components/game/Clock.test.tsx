import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Clock } from "./Clock";
import { CommentFeed } from "./CommentFeed";

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

describe("Clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down while the side is to move and stops at zero", () => {
    render(
      <Clock deadlineAt={new Date(NOW + 60_000).toISOString()} timePerMoveMs={60_000} running label="White clock" />,
    );
    expect(screen.getByRole("timer", { name: "White clock" })).toHaveTextContent("60.0");

    // Advancing the fake timers moves the mocked clock with them.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("timer", { name: "White clock" })).toHaveTextContent("59.0");

    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.getByRole("timer", { name: "White clock" })).toHaveTextContent("0.0");
  });

  it("shows the full clock and does not tick when it is the other side's turn", () => {
    const { container } = render(
      <Clock deadlineAt={null} timePerMoveMs={60_000} running={false} label="Black clock" />,
    );
    expect(screen.getByRole("timer", { name: "Black clock" })).toHaveTextContent("60.0");
    expect(container.querySelector(".clock-fill")?.getAttribute("style")).toContain("100");
  });
});

describe("CommentFeed", () => {
  const move = {
    ply: 1,
    color: "white" as const,
    san: "e4",
    uci: "e2e4",
    fen: "",
    comment: "Centre.",
    thinkTimeMs: 8_100,
    at: "2026-09-04T10:00:00.000Z",
  };

  it("shows only this colour's comments, as plain text", () => {
    render(
      <CommentFeed
        color="white"
        name="opusbot"
        moves={[move, { ...move, ply: 2, color: "black", comment: "<b>hi</b>" }]}
        attempts={[]}
      />,
    );
    expect(screen.getByText("Centre.")).toBeInTheDocument();
    expect(screen.queryByText("hi")).toBeNull();
  });

  it("lists a rejected attempt next to the moves", () => {
    render(
      <CommentFeed
        color="black"
        name="tal-turbo"
        moves={[]}
        attempts={[{ ply: 2, color: "black", submitted: "Qz9", reason: "unparseable", at: move.at }]}
      />,
    );
    expect(screen.getByText("Qz9")).toBeInTheDocument();
    expect(screen.getByText(/rejected: unparseable/i)).toBeInTheDocument();
  });

  it("says when an agent has said nothing", () => {
    render(<CommentFeed color="white" name="opusbot" moves={[]} attempts={[]} />);
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });
});
