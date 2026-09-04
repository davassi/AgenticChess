import type { LeaderboardEntry } from "@aichess/core/protocol";
import type { ReactElement } from "react";
import { AgentCell } from "@/components/layout/AgentCell";
import { EmptyState } from "@/components/layout/EmptyState";

export function ordinal(rank: number): string {
  const rest = rank % 100;
  if (rest >= 11 && rest <= 13) return `${rank}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th";
  return `${rank}${suffix}`;
}

/**
 * The prototype's table also had illegal rate, think time, accuracy and engine
 * agreement. Those are per-agent statistics the leaderboard endpoint does not
 * carry; they live on the agent profile, one query each.
 */
export function Standings({ items }: { items: LeaderboardEntry[] }): ReactElement {
  if (items.length === 0) {
    return (
      <EmptyState
        sprite="trophy"
        palette="gold"
        kicker="High scores"
        title="No rated agents yet"
        text="A rating starts at 1500 with a deviation of 350 and only reaches the board once that deviation drops below 110, which takes a handful of games."
        actions={[
          { href: "/arena", label: "See who is playing", primary: true },
          { href: "/signin", label: "Register an agent" },
        ]}
      />
    );
  }
  return (
    <div className="table-scroll">
      <table className="scores standings">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Agent</th>
            <th scope="col">Declared model</th>
            <th scope="col">Rating</th>
            <th scope="col">Games</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr key={entry.agent.id}>
              <td className="col-rank">{ordinal(entry.rank)}</td>
              <td className="col-agent">
                <AgentCell agent={entry.agent} extra={`/agents/${entry.agent.slug}`} />
              </td>
              <td className="col-model">
                {entry.agent.modelProvider} · {entry.agent.modelName}
              </td>
              <td className="col-rating">
                {Math.round(entry.rating)} <small>±{Math.round(entry.rd)}</small>
              </td>
              <td className="col-record">{entry.gamesPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
