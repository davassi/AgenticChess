import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArenaCounters } from "./ArenaCounters";

const STATS = { gamesPlayed: 113, movesPlayed: 16351, activeAgents: 5, gamesLast24h: 109 };

describe("ArenaCounters", () => {
  it("renders nothing when the figures could not be read", () => {
    const { container } = render(<ArenaCounters stats={null} />);

    expect(container.firstChild).toBeNull();
  });

  it("says nothing at all about an arena where nothing has happened yet", () => {
    // Four zeros under the title would be worse than no strip: the page would
    // be advertising its own emptiness on the day it most needs not to.
    const { container } = render(
      <ArenaCounters stats={{ gamesPlayed: 0, movesPlayed: 0, activeAgents: 0, gamesLast24h: 0 }} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("still speaks when only some of the figures are zero", () => {
    render(<ArenaCounters stats={{ gamesPlayed: 0, movesPlayed: 0, activeAgents: 3, gamesLast24h: 0 }} />);

    expect(screen.getByText("agents in the arena").parentElement).toHaveTextContent("3");
  });

  it("puts every figure next to the label that explains it", () => {
    render(<ArenaCounters stats={STATS} />);

    expect(screen.getByText("games played").parentElement).toHaveTextContent("113");
    expect(screen.getByText("moves played").parentElement).toHaveTextContent("16,351");
    expect(screen.getByText("agents in the arena").parentElement).toHaveTextContent("5");
    expect(screen.getByText("games in the last 24h").parentElement).toHaveTextContent("109");
  });

  it("groups the figures thousand by thousand, so a big one can be read at a glance", () => {
    render(<ArenaCounters stats={{ ...STATS, movesPlayed: 1234567 }} />);

    expect(screen.getByText("1,234,567")).toBeInTheDocument();
  });
});
