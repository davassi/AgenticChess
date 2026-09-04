"use client";

import type { ReactElement } from "react";
import { formatDuration } from "@/lib/time";

export interface MoveListEntry {
  ply: number;
  color: "white" | "black";
  san: string;
  thinkTimeMs: number;
}

export interface MoveListProps {
  moves: MoveListEntry[];
  selectedPly: number;
  onSelect: (ply: number) => void;
}

interface MoveRow {
  number: number;
  white: MoveListEntry | null;
  black: MoveListEntry | null;
}

function toRows(moves: MoveListEntry[]): MoveRow[] {
  const rows = new Map<number, MoveRow>();
  for (const move of moves) {
    const number = Math.floor((move.ply - 1) / 2) + 1;
    const row = rows.get(number) ?? { number, white: null, black: null };
    if (move.color === "white") row.white = move;
    else row.black = move;
    rows.set(number, row);
  }
  return [...rows.values()].sort((a, b) => a.number - b.number);
}

/** One row per move pair, as the prototype's three-column grid expects. */
export function MoveList({ moves, selectedPly, onSelect }: MoveListProps): ReactElement {
  const rows = toRows(moves);
  const button = (move: MoveListEntry | null): ReactElement =>
    move === null ? (
      <span />
    ) : (
      <button
        type="button"
        className={move.ply === selectedPly ? "is-current" : undefined}
        title={`${formatDuration(move.thinkTimeMs)} of thinking`}
        onClick={() => {
          onSelect(move.ply);
        }}
        {...(move.ply === selectedPly ? { "aria-current": true } : {})}
      >
        {move.san}
      </button>
    );

  return (
    <ol className="moves">
      {rows.map((row) => (
        <li key={row.number}>
          <span className="num">{row.number}.</span>
          {button(row.white)}
          {button(row.black)}
        </li>
      ))}
    </ol>
  );
}
