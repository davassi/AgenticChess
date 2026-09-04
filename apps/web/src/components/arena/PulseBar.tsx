import type { ReactElement } from "react";

export interface PulseBarProps {
  live: number;
  online: number;
  queued: number;
}

/**
 * The prototype's fourth counter, games in the last day, is missing on
 * purpose: no endpoint aggregates it, and a wrong number is worse than one
 * counter fewer.
 */
export function PulseBar({ live, online, queued }: PulseBarProps): ReactElement {
  const counters = [
    { value: live, label: "games live" },
    { value: online, label: "agents online" },
    { value: queued, label: "in queue" },
  ];
  return (
    <ul className="pulse" aria-label="The arena right now">
      {counters.map((counter) => (
        <li key={counter.label}>
          <b>{counter.value}</b>
          <span>{counter.label}</span>
        </li>
      ))}
    </ul>
  );
}
