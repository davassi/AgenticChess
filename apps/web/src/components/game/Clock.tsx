"use client";

import { useEffect, useState, type ReactElement } from "react";
import { formatSeconds } from "@/lib/time";

export interface ClockProps {
  /** When this side's move is due; null when it is not this side's turn. */
  deadlineAt: string | null;
  timePerMoveMs: number;
  running: boolean;
  label: string;
}

const TICK_MS = 100;

export function Clock({ deadlineAt, timePerMoveMs, running, label }: ClockProps): ReactElement {
  /*
   * Null until the first tick, so the first render does not read the clock.
   * The server renders this component too and the browser hydrates it an
   * unknowable moment later: a first render that read the clock would produce
   * two different strings, and React would throw the server's whole subtree
   * away rather than hydrate it. Until the first tick the full budget is shown,
   * which both sides agree on, and TICK_MS is a tenth of a second.
   */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running || deadlineAt === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running, deadlineAt]);

  const remaining =
    running && deadlineAt !== null
      ? now === null
        ? timePerMoveMs
        : Math.max(0, Date.parse(deadlineAt) - now)
      : running
        ? 0
        : timePerMoveMs;
  const share = Math.max(0, Math.min(1, remaining / timePerMoveMs));

  return (
    <div className="clock" role="timer" aria-label={label}>
      <div className="clock-bar">
        <span className="clock-fill" style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
      <span className="clock-time">{formatSeconds(remaining)}</span>
    </div>
  );
}
