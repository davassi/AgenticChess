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

export function MoveList({ moves, selectedPly, onSelect }: MoveListProps): ReactElement {
  return (
    <ol className="moves">
      {moves.map((move) => (
        <li key={move.ply} className={move.color === "white" ? "move move--w" : "move move--b"}>
          <button
            type="button"
            onClick={() => {
              onSelect(move.ply);
            }}
            {...(move.ply === selectedPly ? { "aria-current": true } : {})}
          >
            <span className="ply">
              {Math.floor((move.ply - 1) / 2) + 1}
              {move.color === "white" ? "." : "…"}
            </span>
            <span className="san">{move.san}</span>
            <span className="think">{formatDuration(move.thinkTimeMs)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
