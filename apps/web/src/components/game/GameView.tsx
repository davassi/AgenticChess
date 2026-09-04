"use client";

import Link from "next/link";
import { useMemo, type ReactElement } from "react";
import { Board2D } from "@/components/board/Board2D";
import { MoveList } from "@/components/board/MoveList";
import { resultLabel, spaced } from "@/components/games/GameRow";
import { AgentCell } from "@/components/layout/AgentCell";
import { useGameStream } from "@/hooks/useGameStream";
import { useReplay } from "@/hooks/useReplay";
import { gameStreamUrl, pgnUrl } from "@/lib/api";
import type { LiveGame } from "@/lib/live";
import { positionsFrom, startingPosition } from "@/lib/position";
import { toListItem } from "@/lib/snapshot";
import { Clock } from "./Clock";
import { CommentFeed } from "./CommentFeed";

export interface GameViewProps {
  initial: LiveGame;
  apiPublicUrl: string;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

export function GameView({ initial, apiPublicUrl }: GameViewProps): ReactElement {
  const live = useGameStream(gameStreamUrl(apiPublicUrl, initial.snapshot.id), initial);
  const replay = useReplay(live.moves.length);
  const positions = useMemo(() => positionsFrom(live.moves.map((move) => move.uci)), [live.moves]);

  const snapshot = live.snapshot;
  const active = snapshot.status === "active";
  const position = positions[replay.ply] ?? startingPosition();
  const shown = live.moves[replay.ply - 1];
  const lastMove = shown === undefined ? null : { from: shown.uci.slice(0, 2), to: shown.uci.slice(2, 4) };

  function player(color: "white" | "black"): ReactElement {
    const agent = color === "white" ? snapshot.white : snapshot.black;
    // The clock only runs on the live position: rewinding is not a pause.
    const running = active && snapshot.turn === color && replay.isLive;
    return (
      <div className={`player player--${color}`} data-side={color}>
        <AgentCell agent={agent} scale={2} extra={`${agent.modelProvider} · ${agent.modelName}`} />
        <Clock
          deadlineAt={running ? snapshot.moveDeadlineAt : null}
          timePerMoveMs={snapshot.config.timePerMoveMs}
          running={running}
          label={`${color === "white" ? "White" : "Black"} clock`}
        />
      </div>
    );
  }

  return (
    <section className="screen screen--game" aria-labelledby="game-heading">
      <div className="frame frame--game">
        <span className={active ? "hud hud--live" : "hud"}>
          {active ? <span className="live-dot" aria-hidden="true" /> : null}
          {active ? "Live" : "Finished"} · rated · {Math.round(snapshot.config.timePerMoveMs / 1000)} s per move
        </span>
        <span className="hud hud--right">
          move {Math.floor(snapshot.ply / 2) + 1} · {snapshot.ply} plies
        </span>
        <h2 id="game-heading" className="visually-hidden">
          {snapshot.white.name} against {snapshot.black.name}
        </h2>

        <div className="game">
          <div className="stage">
            {player("black")}
            <div className="board-shell">
              <div className="ranks" aria-hidden="true">
                {RANKS.map((rank) => (
                  <span key={rank}>{rank}</span>
                ))}
              </div>
              <div className="board-views" onKeyDown={replay.onKeyDown}>
                <Board2D
                  position={position}
                  lastMove={lastMove}
                  label={`Board after ${replay.ply} ${replay.ply === 1 ? "ply" : "plies"}`}
                />
              </div>
              <div className="files" aria-hidden="true">
                {FILES.map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
            </div>
            {player("white")}
            <p className="board-hint">Arrow keys step through the moves. End returns to the live position.</p>
          </div>

          <div className="side">
            <aside className="movelist-panel" aria-label="Moves">
              <p className="panel-title">Moves</p>
              <MoveList
                moves={live.moves.map((move) => ({
                  ply: move.ply,
                  color: move.color,
                  san: move.san,
                  thinkTimeMs: move.thinkTimeMs,
                }))}
                selectedPly={replay.ply}
                onSelect={replay.setPly}
              />
              <p className="panel-foot">
                {replay.isLive ? (
                  active ? (
                    "Following live"
                  ) : (
                    "Final position"
                  )
                ) : (
                  <button type="button" className="btn btn--ghost btn--small" onClick={replay.goLive}>
                    Back to the {active ? "live" : "final"} position
                  </button>
                )}
              </p>
            </aside>
          </div>
        </div>

        <div className="feeds">
          <CommentFeed color="white" name={snapshot.white.name} moves={live.moves} attempts={live.attempts} />
          <CommentFeed color="black" name={snapshot.black.name} moves={live.moves} attempts={live.attempts} />
        </div>

        {live.finished ? (
          <div className="result">
            <p className="result-title">{snapshot.termination === null ? "Finished" : spaced(snapshot.termination)}</p>
            <p className="result-score">
              {snapshot.result} · {resultLabel(toListItem(snapshot))}
            </p>
            <p className="result-exits">
              <a className="btn btn--ghost btn--small" href={pgnUrl(apiPublicUrl, snapshot.id)}>
                Download the PGN
              </a>
              <Link className="btn btn--ghost btn--small" href="/games">
                The archive
              </Link>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
