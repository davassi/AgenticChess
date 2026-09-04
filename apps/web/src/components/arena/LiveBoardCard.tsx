"use client";

import type { GameListItem } from "@aichess/core/protocol";
import Link from "next/link";
import type { ReactElement } from "react";
import { IsoScene } from "@/components/board/IsoScene";
import { AgentCell } from "@/components/layout/AgentCell";
import { useLiveFen } from "@/hooks/useLiveFen";
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
  const live = game.status === "active";
  const fen = useLiveFen(gameStreamUrl(apiPublicUrl, game.id), game.fen, live);
  return (
    <li className="board-card">
      <span className="board-id">
        <span>Game #{game.id.slice(0, 8)}</span>
        {live ? <span className="chip chip--live">live</span> : null}
      </span>
      <Link
        className="board-link"
        href={`/games/${game.id}`}
        aria-label={`Watch ${game.white.name} against ${game.black.name}`}
      >
        <IsoScene
          kind="board"
          className="mini"
          width={128}
          height={134}
          maxScale={2}
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
          {game.turn === "white" ? "White" : "Black"} to move · started {timeAgo(game.startedAt ?? game.createdAt)}
        </span>
      </p>
      <Link className="btn btn--start" href={`/games/${game.id}`}>
        Watch
      </Link>
    </li>
  );
}
