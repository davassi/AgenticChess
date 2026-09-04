"use client";

import { useState } from "react";
import { useWireStream } from "./useWireStream";

export interface LiveBoard {
  fen: string;
  /** False once the game is over, so a card stops calling itself live. */
  active: boolean;
}

/**
 * The arena's small boards need the position and whether the game is still
 * being played; a whole LiveGame would mean inventing the fields a list item
 * does not carry. The side to move is not one of them: it is read from the
 * FEN, which is the same string the board is drawn from and cannot fall out
 * of step with it.
 */
export function useLiveBoard(url: string, initialFen: string, initiallyActive: boolean): LiveBoard {
  const [board, setBoard] = useState<LiveBoard>({ fen: initialFen, active: initiallyActive });

  useWireStream(url, initiallyActive, (event) => {
    if (event.type === "game.move") setBoard((current) => ({ ...current, fen: event.fen }));
    else if (event.type === "game.snapshot") setBoard({ fen: event.game.fen, active: event.game.status === "active" });
    else if (event.type === "game.end") setBoard((current) => ({ ...current, active: false }));
  });

  return board;
}
