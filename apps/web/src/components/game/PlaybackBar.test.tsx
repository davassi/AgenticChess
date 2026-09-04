import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Playback } from "@/hooks/usePlayback";
import { PlaybackBar } from "./PlaybackBar";

function playback(overrides: Partial<Playback> = {}): Playback {
  return {
    ply: 5,
    total: 10,
    lag: 5,
    following: true,
    playing: false,
    atLive: false,
    speed: 1,
    setSpeed: vi.fn(),
    setPly: vi.fn(),
    step: vi.fn(),
    goLive: vi.fn(),
    restart: vi.fn(),
    toggle: vi.fn(),
    onKeyDown: vi.fn(),
    ...overrides,
  };
}

describe("PlaybackBar", () => {
  it("plays and pauses through the same button", async () => {
    const toggle = vi.fn();
    const { rerender } = render(<PlaybackBar playback={playback({ toggle })} active />);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(toggle).toHaveBeenCalledOnce();

    rerender(<PlaybackBar playback={playback({ toggle, playing: true })} active />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("steps one ply in each direction", async () => {
    const step = vi.fn();
    render(<PlaybackBar playback={playback({ step })} active />);
    await userEvent.click(screen.getByRole("button", { name: "Next move" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous move" }));
    expect(step).toHaveBeenNthCalledWith(1, 1);
    expect(step).toHaveBeenNthCalledWith(2, -1);
  });

  it("offers the way back to the live position, and disables it once there", () => {
    const { rerender } = render(<PlaybackBar playback={playback()} active />);
    expect(screen.getByRole("button", { name: "Back to the live position" })).toBeEnabled();

    rerender(<PlaybackBar playback={playback({ ply: 10, lag: 0, atLive: true })} active />);
    expect(screen.getByRole("button", { name: "Back to the live position" })).toBeDisabled();
  });

  it("calls the final position by its name once the game is over", () => {
    render(<PlaybackBar playback={playback({ following: false })} active={false} />);
    expect(screen.getByRole("button", { name: "Back to the final position" })).toBeInTheDocument();
  });

  it("says how far behind the viewer is, once it is worth saying", () => {
    const { rerender } = render(<PlaybackBar playback={playback({ lag: 5 })} active />);
    expect(screen.getByText("5 moves behind")).toBeInTheDocument();

    rerender(<PlaybackBar playback={playback({ lag: 1 })} active />);
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  // A move every 2.5 s through a live region would flood a screen reader, so
  // the region carries the state and never the moves.
  it("announces the state and not the moves", () => {
    const { rerender } = render(<PlaybackBar playback={playback({ ply: 10, lag: 0, atLive: true })} active />);
    expect(screen.getByText("At the live position")).toBeInTheDocument();

    rerender(<PlaybackBar playback={playback({ ply: 4, lag: 6 })} active />);
    expect(screen.getByText("Behind the live position")).toBeInTheDocument();
  });

  it("changes speed through a labelled control", async () => {
    const setSpeed = vi.fn();
    render(<PlaybackBar playback={playback({ setSpeed })} active />);
    await userEvent.selectOptions(screen.getByLabelText("Playback speed"), "instant");
    expect(setSpeed).toHaveBeenCalledWith("instant");
  });

  it("goes to the first move without starting a replay", async () => {
    const setPly = vi.fn();
    const toggle = vi.fn();
    render(<PlaybackBar playback={playback({ setPly, toggle })} active />);
    await userEvent.click(screen.getByRole("button", { name: "Back to the first move" }));
    expect(setPly).toHaveBeenCalledWith(0);
    expect(toggle).not.toHaveBeenCalled();
  });
});
