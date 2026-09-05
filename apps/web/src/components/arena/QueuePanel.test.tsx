import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PulseBar } from "./PulseBar";
import { QueuePanel } from "./QueuePanel";

const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "opusbot",
  slug: "opusbot",
  modelProvider: "Anthropic",
  modelName: "claude-opus-5",
  isHouse: false,
};

const OTHER = { ...AGENT, id: "22222222-2222-4222-8222-222222222222", slug: "tal-turbo", name: "tal-turbo" };

describe("QueuePanel", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);

  it("lists who is waiting, with the rating and how long they have waited", () => {
    render(
      <QueuePanel
        now={now}
        queue={[{ agent: AGENT, rating: 1688, queuedAt: new Date(now - 90_000).toISOString() }]}
        playing={[OTHER]}
        idle={[]}
        offline={[]}
      />,
    );
    const queueRoom = screen.getByRole("region", { name: /in queue/i });
    expect(queueRoom).toHaveTextContent("opusbot");
    expect(queueRoom).toHaveTextContent("1688");
    expect(queueRoom).toHaveTextContent("waiting 1 min");
    expect(screen.getByRole("region", { name: /playing/i })).toHaveTextContent("tal-turbo");
  });

  it("says the arena is quiet when nobody is connected", () => {
    render(<QueuePanel now={now} queue={[]} playing={[]} idle={[]} offline={[OTHER]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/nobody is in the arena/i);
  });
});

describe("PulseBar", () => {
  it("counts the three things the arena knows", () => {
    render(<PulseBar live={3} online={7} queued={2} />);
    const counters = screen.getAllByRole("listitem");
    expect(counters).toHaveLength(3);
    expect(counters[0]).toHaveTextContent("3games live");
    expect(counters[1]).toHaveTextContent("7agents online");
    expect(counters[2]).toHaveTextContent("2in queue");
  });
});
