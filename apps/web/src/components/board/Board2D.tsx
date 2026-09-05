import type { ReactElement } from "react";
import { Sprite } from "@/components/layout/Sprite";
import type { PaletteName, SpriteName } from "@/lib/pixel";
import { squareOffsets, type Position, type Square } from "@/lib/position";

export interface Board2DProps {
  position: Position;
  lastMove: { from: Square; to: Square } | null;
  /** The square of a king in check, or an illegal attempt to flash. */
  mark?: { square: Square; kind: "check" | "illegal" } | null;
  label?: string;
}

const SQUARES = Array.from({ length: 64 }, (_, index) => index);

function spriteFor(kind: string): { name: SpriteName; palette: PaletteName } {
  const [color, piece] = kind.split("-");
  return { name: (piece ?? "pawn") as SpriteName, palette: color === "w" ? "white" : "black" };
}

function offsetStyle(square: Square): { transform: string } {
  const { x, y } = squareOffsets(square);
  return { transform: `translate(${x * 100}%, ${y * 100}%)` };
}

/**
 * The prototype's DOM, kept: squares, marks and pieces in three stacked grids.
 *
 * Pieces are keyed by their identity so React reuses the same node, and drawn
 * in a fixed order so it never has to move it. Both halves are needed: React
 * reorders keyed children with insertBefore, which detaches and re-attaches
 * the node, and a CSS transition does not run on a node that was just
 * re-inserted. `applyUci` re-appends the moving piece to the position's map,
 * so following that order would move exactly the one node that is supposed to
 * slide - which is why only a piece moving twice in a row used to animate.
 *
 * Sorting by id is stable for a whole game: an id is the square a piece
 * started on and never changes, and a capture only removes one.
 */
export function Board2D({ position, lastMove, mark = null, label = "Chess board" }: Board2DProps): ReactElement {
  return (
    <div className="board2d" role="img" aria-label={label} tabIndex={0}>
      <div className="squares">
        {SQUARES.map((index) => (
          <div key={index} className={(index + Math.floor(index / 8)) % 2 ? "sq sq--dark" : "sq sq--light"} />
        ))}
      </div>
      <div className="marks">
        {lastMove === null
          ? null
          : [lastMove.from, lastMove.to].map((square) => (
              <div key={square} className="mark mark--last" style={offsetStyle(square)} />
            ))}
        {mark === null ? null : (
          <div className={`mark mark--${mark.kind}`} style={offsetStyle(mark.square)}>
            {mark.kind === "illegal" ? "✗" : null}
          </div>
        )}
      </div>
      <div className="pieces">
        {[...position.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((piece) => {
            const sprite = spriteFor(piece.kind);
            return (
              <div key={piece.id} className="piece" data-piece-id={piece.id} style={offsetStyle(piece.square)}>
                <Sprite name={sprite.name} palette={sprite.palette} scale={3} />
              </div>
            );
          })}
      </div>
    </div>
  );
}
