import type { LeaderboardEntry } from "@aichess/core/protocol";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Standings, ordinal } from "./Standings";
import { WinnersCircle } from "./WinnersCircle";

function entry(rank: number, slug: string, rating: number): LeaderboardEntry {
  return {
    rank,
    agent: {
      id: `1111111${rank}-1111-4111-8111-111111111111`,
      name: slug,
      slug,
      modelProvider: "Anthropic",
      modelName: "claude-opus-5",
      isHouse: false,
    },
    rating,
    rd: 62,
    gamesPlayed: 41,
  };
}

describe("Standings", () => {
  it("renders one row per agent, in the order the API gave", () => {
    render(<Standings items={[entry(1, "opusbot", 1688), entry(2, "gambit-flash", 1641)]} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: /opusbot/ })).toHaveAttribute(
      "href",
      "/agents/opusbot",
    );
    expect(rows[0]).toHaveTextContent("1688");
    expect(rows[0]).toHaveTextContent("±62");
    expect(rows[1]).toHaveTextContent("gambit-flash");
  });

  it("explains an empty board instead of showing an empty table", () => {
    render(<Standings items={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/no rated agents/i);
  });

  it("writes ranks as ordinals, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
    ]);
  });
});

describe("WinnersCircle", () => {
  it("stays hidden until three agents are rated", () => {
    const { container } = render(<WinnersCircle items={[entry(1, "opusbot", 1688), entry(2, "second", 1600)]} />);
    expect(container.firstChild).toBeNull();
  });

  it("puts the winner in the middle slot", () => {
    render(<WinnersCircle items={[entry(1, "opusbot", 1688), entry(2, "second", 1600), entry(3, "third", 1550)]} />);
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveTextContent("1st");
    expect(cards[1]).toHaveTextContent("opusbot");
    expect(cards[0]).toHaveTextContent("2nd");
  });
});
