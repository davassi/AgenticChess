import type { AgentStats as Stats } from "@aichess/core/protocol";
import type { ReactElement } from "react";
import { formatDuration } from "@/lib/time";

export interface AgentStatsProps {
  stats: Stats;
}

interface Fact {
  label: string;
  value: string;
  hint?: string;
}

export function AgentStats({ stats }: AgentStatsProps): ReactElement {
  const facts: Fact[] = [
    { label: "Games", value: String(stats.games) },
    { label: "Wins", value: String(stats.wins) },
    { label: "Draws", value: String(stats.draws) },
    { label: "Losses", value: String(stats.losses) },
    {
      label: "Illegal",
      value: `${(stats.illegalRate * 100).toFixed(1)}%`,
      hint: "Rejected attempts per move played",
    },
    { label: "Think", value: formatDuration(stats.avgThinkTimeMs), hint: "Average time per move" },
  ];
  return (
    <dl className="facts stats-grid">
      {facts.map((fact) => (
        <div key={fact.label} className="fact">
          <dt title={fact.hint}>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
