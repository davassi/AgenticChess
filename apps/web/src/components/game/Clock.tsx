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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || deadlineAt === null) return;
    // The first tick lands one interval later; the initial state is already now.
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running, deadlineAt]);

  const remaining =
    running && deadlineAt !== null ? Math.max(0, Date.parse(deadlineAt) - now) : running ? 0 : timePerMoveMs;
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
