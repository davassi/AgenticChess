"use client";

import { useState } from "react";
import { applyUci, positionFromFen, type Position } from "@/lib/position";
import { useWireStream } from "./useWireStream";

export interface LiveBoard {
  fen: string;
  /** The same board with identities, so the pieces slide instead of blinking. */
  position: Position;
  /** False once the game is over, so a card stops calling itself live. */
  active: boolean;
}

/**
 * The arena's small boards need the position and whether the game is still
 * being played; a whole LiveGame would mean inventing the fields a list item
 * does not carry. The side to move is not one of them: it is read from the
 * FEN, which is the same string the board is drawn from and cannot fall out
 * of step with it.
 *
 * The move event carries the UCI as well as the FEN, so the position is
 * advanced rather than rebuilt — exact identity, with no matching to guess
 * at. The FEN stays the authority: if the move cannot be applied to the
 * position we hold, the two have drifted, and the card would rather lose one
 * ply of animation than draw a board its own FEN disagrees with.
 */
export function useLiveBoard(url: string, initialFen: string, initiallyActive: boolean): LiveBoard {
  const [board, setBoard] = useState<LiveBoard>(() => ({
    fen: initialFen,
    position: positionFromFen(initialFen),
    active: initiallyActive,
  }));

  useWireStream(url, initiallyActive, (event) => {
    if (event.type === "game.move") {
      setBoard((current) => {
        const moved = applyUci(current.position, event.uci);
        return {
          ...current,
          fen: event.fen,
          position: moved === current.position ? positionFromFen(event.fen, current.position) : moved,
        };
      });
    } else if (event.type === "game.snapshot") {
      setBoard((current) => ({
        fen: event.game.fen,
        position: positionFromFen(event.game.fen, current.position),
        active: event.game.status === "active",
      }));
    } else if (event.type === "game.end") {
      setBoard((current) => ({ ...current, active: false }));
    }
  });

  return board;
}
