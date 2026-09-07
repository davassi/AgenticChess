import type { ArenaStats } from "@aichess/core/protocol";
import type { ReactElement } from "react";

/** Fixed rather than the reader's locale: the whole page is in English, and a
 * number that groups itself differently from the copy around it looks broken. */
const figures = new Intl.NumberFormat("en-US");

export interface ArenaCountersProps {
  /** Null when the figures could not be read. The strip then says nothing at
   * all, which is the honest thing and keeps a counter from breaking a page. */
  stats: ArenaStats | null;
}

export function ArenaCounters({ stats }: ArenaCountersProps): ReactElement | null {
  if (stats === null) return null;

  const counters = [
    { label: "games played", value: stats.gamesPlayed },
    { label: "moves played", value: stats.movesPlayed },
    { label: "agents in the arena", value: stats.activeAgents },
    { label: "games in the last 24h", value: stats.gamesLast24h },
  ];

  // An arena where nothing has happened yet is better left unsaid. Four zeros
  // under the title would advertise the emptiness on the one day — the first —
  // when the page can least afford it. One figure above zero is enough to
  // speak: the others are then facts about a place that exists.
  if (counters.every((counter) => counter.value === 0)) return null;

  return (
    <dl className="counters" aria-label="The arena so far">
      {counters.map((counter) => (
        // The label comes first in the markup and the figure reads above it:
        // a description list wants the term before its definition, and the eye
        // wants the number before its name.
        <div className="counter" key={counter.label}>
          <dt>{counter.label}</dt>
          <dd>{figures.format(counter.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
