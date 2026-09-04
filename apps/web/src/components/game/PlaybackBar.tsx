"use client";

import type { ReactElement } from "react";
import type { Playback } from "@/hooks/usePlayback";
import { LAG_VISIBLE, parseSpeed, SPEEDS, type Speed } from "@/lib/playback";

export interface PlaybackBarProps {
  playback: Playback;
  /** False once the game is over: the last button then means "the end". */
  active: boolean;
}

const SPEED_LABELS: Record<string, string> = {
  "0.5": "0.5×",
  "1": "1×",
  "2": "2×",
  instant: "Instant",
};

function speedLabel(speed: Speed): string {
  return SPEED_LABELS[String(speed)] ?? String(speed);
}

/**
 * The transport under the board. The keyboard already drives the same cursor
 * from the board itself; this is the visible half of it, and the only place
 * the viewer can change the pace.
 */
export function PlaybackBar({ playback, active }: PlaybackBarProps): ReactElement {
  const { ply, total, lag, playing, atLive, speed } = playback;
  const liveLabel = active ? "Back to the live position" : "Back to the final position";
  return (
    <div className="playback" role="group" aria-label="Playback">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Back to the first move"
        disabled={total === 0 || ply === 0}
        onClick={() => {
          playback.setPly(0);
        }}
      >
        |&lt;
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Previous move"
        disabled={ply === 0}
        onClick={() => {
          playback.step(-1);
        }}
      >
        &lt;&lt;
      </button>
      <button
        type="button"
        className="btn btn--small"
        aria-label={playing ? "Pause" : "Play"}
        disabled={total === 0}
        onClick={playback.toggle}
      >
        {playing ? "||" : ">"}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Next move"
        disabled={ply >= total}
        onClick={() => {
          playback.step(1);
        }}
      >
        &gt;&gt;
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label={liveLabel}
        disabled={atLive || total === 0}
        onClick={playback.goLive}
      >
        &gt;|
      </button>

      <label className="playback-speed">
        <span className="visually-hidden">Playback speed</span>
        <select
          value={String(speed)}
          onChange={(event) => {
            playback.setSpeed(parseSpeed(event.target.value));
          }}
        >
          {SPEEDS.map((option) => (
            <option key={String(option)} value={String(option)}>
              {speedLabel(option)}
            </option>
          ))}
        </select>
      </label>

      {lag > LAG_VISIBLE ? <span className="playback-lag">{lag} moves behind</span> : null}

      <span className="visually-hidden" aria-live="polite">
        {atLive ? (active ? "At the live position" : "At the final position") : "Behind the live position"}
      </span>
    </div>
  );
}
