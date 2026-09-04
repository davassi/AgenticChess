/*
 * The board position as a map of squares to pieces that keep their identity.
 *
 * React only reuses a DOM node when its key is stable, and the CSS transition
 * on `.piece` is what makes a move slide. Replaying the UCI moves gives every
 * piece an id from the square it started on, exactly as the prototype did;
 * `positionFromFen` exists for the places that show a position without its
 * history, like the arena's small boards.
 */

export type Square = string;

export type PieceKind =
  | "w-pawn"
  | "w-knight"
  | "w-bishop"
  | "w-rook"
  | "w-queen"
  | "w-king"
  | "b-pawn"
  | "b-knight"
  | "b-bishop"
  | "b-rook"
  | "b-queen"
  | "b-king";

export interface PlacedPiece {
  /** Stable across moves: the square this piece started on. */
  id: string;
  kind: PieceKind;
  square: Square;
}

export type Position = ReadonlyMap<Square, PlacedPiece>;

const FILES = "abcdefgh";

const KIND_BY_LETTER: Record<string, PieceKind> = {
  P: "w-pawn",
  N: "w-knight",
  B: "w-bishop",
  R: "w-rook",
  Q: "w-queen",
  K: "w-king",
  p: "b-pawn",
  n: "b-knight",
  b: "b-bishop",
  r: "b-rook",
  q: "b-queen",
  k: "b-king",
};

const PROMOTION: Record<string, "queen" | "rook" | "bishop" | "knight"> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
};

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Only the placement field of the FEN is read; the rest is state the board does not draw. */
export function positionFromFen(fen: string): Position {
  const placement = fen.split(" ")[0] ?? "";
  const position = new Map<Square, PlacedPiece>();
  const ranks = placement.split("/");
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
    const row = ranks[rankIndex];
    if (row === undefined) continue;
    const rank = 8 - rankIndex;
    let file = 0;
    for (const character of row) {
      const skip = Number(character);
      if (Number.isFinite(skip) && character !== "") {
        file += skip;
        continue;
      }
      const kind = KIND_BY_LETTER[character];
      const fileLetter = FILES[file];
      if (kind !== undefined && fileLetter !== undefined) {
        const square = `${fileLetter}${rank}`;
        position.set(square, { id: square, kind, square });
      }
      file += 1;
    }
  }
  return position;
}

export function startingPosition(): Position {
  return positionFromFen(START_FEN);
}

function colorOf(kind: PieceKind): "w" | "b" {
  return kind.startsWith("w-") ? "w" : "b";
}

function rookMoveForCastling(from: Square, to: Square, kind: PieceKind): { from: Square; to: Square } | null {
  if (kind !== "w-king" && kind !== "b-king") return null;
  const rank = from[1] ?? "";
  if (from[0] !== "e" || (rank !== "1" && rank !== "8")) return null;
  if (to === `g${rank}`) return { from: `h${rank}`, to: `f${rank}` };
  if (to === `c${rank}`) return { from: `a${rank}`, to: `d${rank}` };
  return null;
}

/** Applies one move in UCI: captures, castling, en passant and promotion included. */
export function applyUci(position: Position, uci: string): Position {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.slice(4, 5);
  const moving = position.get(from);
  if (moving === undefined) return position;

  const next = new Map(position);
  next.delete(from);
  next.delete(to);

  // A pawn that changes file onto an empty square took the passed pawn.
  const isPawn = moving.kind === "w-pawn" || moving.kind === "b-pawn";
  if (isPawn && from[0] !== to[0] && position.get(to) === undefined) {
    next.delete(`${to[0] ?? ""}${from[1] ?? ""}`);
  }

  const castling = rookMoveForCastling(from, to, moving.kind);
  if (castling !== null) {
    const rook = position.get(castling.from);
    if (rook !== undefined) {
      next.delete(castling.from);
      next.set(castling.to, { ...rook, square: castling.to });
    }
  }

  const promoted = PROMOTION[promotion];
  const kind: PieceKind = promoted === undefined ? moving.kind : (`${colorOf(moving.kind)}-${promoted}` as PieceKind);
  next.set(to, { id: moving.id, kind, square: to });
  return next;
}

/** One position per ply: index 0 is the start, index n is after n moves. */
export function positionsFrom(uciMoves: readonly string[], from: Position = startingPosition()): Position[] {
  const positions: Position[] = [from];
  let current = from;
  for (const uci of uciMoves) {
    current = applyUci(current, uci);
    positions.push(current);
  }
  return positions;
}

/** a8 is the top-left square, h1 the bottom-right one, as the prototype drew it. */
export function squareOffsets(square: Square): { x: number; y: number } {
  return { x: FILES.indexOf(square[0] ?? ""), y: 8 - Number(square[1] ?? "0") };
}
