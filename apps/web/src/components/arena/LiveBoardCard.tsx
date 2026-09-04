"use client";

import { turnOf } from "@aichess/core";
import type { GameListItem } from "@aichess/core/protocol";
import Link from "next/link";
import type { ReactElement } from "react";
import { IsoScene } from "@/components/board/IsoScene";
import { AgentCell } from "@/components/layout/AgentCell";
import { useLiveBoard } from "@/hooks/useLiveBoard";
import { gameStreamUrl } from "@/lib/api";
import type { IsoPosition } from "@/lib/iso";
import { positionFromFen } from "@/lib/position";
import { timeAgo } from "@/lib/time";

export interface LiveBoardCardProps {
  game: GameListItem;
  apiPublicUrl: string;
}

function toIsoPosition(fen: string): IsoPosition {
  const position: IsoPosition = {};
  for (const [square, piece] of positionFromFen(fen)) position[square] = piece.kind;
  return position;
}

export function LiveBoardCard({ game, apiPublicUrl }: LiveBoardCardProps): ReactElement {
  // Everything the card says about the game comes from the stream: the list
  // item is only where it starts. A game that ends while the arena is open
  // would otherwise keep its live badge and its side to move for ever.
  const { fen, active } = useLiveBoard(gameStreamUrl(apiPublicUrl, game.id), game.fen, game.status === "active");
  const turn = turnOf(fen);
  return (
    <li className="board-card">
      <span className="board-id">
        <span>Game #{game.id.slice(0, 8)}</span>
        {active ? <span className="chip chip--live">live</span> : null}
      </span>
      <Link
        className="board-link"
        href={`/games/${game.id}`}
        aria-label={`Watch ${game.white.name} against ${game.black.name}`}
      >
        <IsoScene
          kind="board"
          className="mini"
          width={256}
          height={186}
          maxScale={1}
          position={toIsoPosition(fen)}
          label="Current position"
        />
      </Link>
      <div className="board-side">
        <AgentCell agent={game.black} extra={game.black.modelName} />
      </div>
      <div className="board-side">
        <AgentCell agent={game.white} extra={game.white.modelName} />
      </div>
      <p className="board-foot">
        <span>
          {active ? `${turn === "white" ? "White" : "Black"} to move` : "Game over"} · started{" "}
          {timeAgo(game.startedAt ?? game.createdAt)}
        </span>
      </p>
      <Link className="btn btn--start" href={`/games/${game.id}`}>
        Watch
      </Link>
    </li>
  );
}
