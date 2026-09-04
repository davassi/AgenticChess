import type { GameListItem } from "@aichess/core/protocol";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameFilters } from "./GameFilters";
import { GameRow, resultLabel } from "./GameRow";

const BASE: GameListItem = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "finished",
  white: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "opusbot",
    slug: "opusbot",
    modelProvider: "Anthropic",
    modelName: "claude-opus-5",
  },
  black: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "tal-turbo",
    slug: "tal-turbo",
    modelProvider: "OpenAI",
    modelName: "gpt-5",
  },
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  ply: 41,
  turn: "white",
  result: "1-0",
  termination: "checkmate",
  moveDeadlineAt: null,
  createdAt: "2026-09-04T09:00:00.000Z",
  startedAt: "2026-09-04T09:00:00.000Z",
  finishedAt: "2026-09-04T09:20:00.000Z",
};

function renderRow(game: GameListItem): void {
  render(
    <table>
      <tbody>
        <GameRow game={game} />
      </tbody>
    </table>,
  );
}

describe("GameRow", () => {
  it("names the winner and the way the game ended", () => {
    renderRow(BASE);
    expect(screen.getByRole("link", { name: /opusbot/ })).toHaveAttribute("href", "/agents/opusbot");
    expect(screen.getByRole("link", { name: "Replay" })).toHaveAttribute("href", `/games/${BASE.id}`);
    expect(resultLabel(BASE)).toBe("opusbot won by checkmate");
    expect(resultLabel({ ...BASE, result: "0-1", termination: "timeout" })).toBe("tal-turbo won on time");
    expect(resultLabel({ ...BASE, result: "1/2-1/2", termination: "threefold_repetition" })).toBe(
      "Draw by threefold repetition",
    );
    expect(resultLabel({ ...BASE, status: "aborted", result: null, termination: "aborted" })).toBe("Aborted");
  });

  it("shows a live game as live, with the side to move", () => {
    renderRow({ ...BASE, status: "active", result: null, termination: null, finishedAt: null, ply: 3 });
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Watch" })).toBeInTheDocument();
    expect(resultLabel({ ...BASE, status: "active", result: null, termination: null })).toBe("White to move");
  });
});

describe("GameFilters", () => {
  const agents = [
    { slug: "opusbot", name: "opusbot" },
    { slug: "tal-turbo", name: "tal-turbo" },
  ];

  it("is a GET form, so a filtered archive is a URL", () => {
    const { container } = render(<GameFilters agents={agents} selected={{ agent: "opusbot", outcome: "win" }} />);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/games");
    expect(screen.getByLabelText(/agent/i)).toHaveValue("opusbot");
    expect(screen.getByLabelText(/result/i)).toHaveValue("win");
  });

  it("disables the outcome filter until an agent is chosen, because the API requires one", () => {
    render(<GameFilters agents={agents} selected={{}} />);
    expect(screen.getByLabelText(/result/i)).toBeDisabled();
  });
});
