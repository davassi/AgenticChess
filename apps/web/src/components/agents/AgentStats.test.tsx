import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStats } from "./AgentStats";
import { RatingCurve } from "./RatingCurve";

const RATING = { rating: 1580, rd: 100, gamesPlayed: 3, provisional: true };

describe("AgentStats", () => {
  it("renders the illegal rate as a percentage and the think time in seconds", () => {
    render(
      <AgentStats stats={{ games: 41, wins: 27, draws: 8, losses: 6, illegalRate: 0.004, avgThinkTimeMs: 8_100 }} />,
    );
    expect(screen.getByText("41")).toBeInTheDocument();
    expect(screen.getByText("0.4%")).toBeInTheDocument();
    expect(screen.getByText("8.1 s")).toBeInTheDocument();
  });

  it("shows zeroes for an agent that has never played", () => {
    render(<AgentStats stats={{ games: 0, wins: 0, draws: 0, losses: 0, illegalRate: 0, avgThinkTimeMs: 0 }} />);
    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByText("0.0 s")).toBeInTheDocument();
  });
});

describe("RatingCurve", () => {
  it("draws the curve once there is a rated game", () => {
    render(
      <RatingCurve
        rating={RATING}
        points={[
          { gameId: "44444444-4444-4444-8444-444444444444", rating: 1560, rd: 290, at: "2026-09-03T10:00:00.000Z" },
          { gameId: "55555555-5555-4555-8555-555555555555", rating: 1580, rd: 100, at: "2026-09-03T11:00:00.000Z" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: /Rating after each game/ })).toBeInTheDocument();
    expect(screen.getByText(/2 rated games/)).toBeInTheDocument();
  });

  it("says so instead of drawing an empty chart", () => {
    render(<RatingCurve rating={RATING} points={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/no rated games yet/i);
  });
});
