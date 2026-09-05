"use client";

import Link from "next/link";
import { useMemo, type ReactElement } from "react";
import { Board2D } from "@/components/board/Board2D";
import { MoveList } from "@/components/board/MoveList";
import { resultLabel, spaced } from "@/components/games/GameRow";
import { AgentCell } from "@/components/layout/AgentCell";
import { useGameStream } from "@/hooks/useGameStream";
import { usePlayback } from "@/hooks/usePlayback";
import { gameStreamUrl, pgnUrl } from "@/lib/api";
import { markForPly } from "@/lib/attempts";
import type { LiveGame } from "@/lib/live";
import { positionFromFen, positionsFrom, startingPosition } from "@/lib/position";
import { toListItem } from "@/lib/snapshot";
import { Clock } from "./Clock";
import { CommentFeed } from "./CommentFeed";
import { PlaybackBar } from "./PlaybackBar";

export interface GameViewProps {
  initial: LiveGame;
  apiPublicUrl: string;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

export function GameView({ initial, apiPublicUrl }: GameViewProps): ReactElement {
  const live = useGameStream(gameStreamUrl(apiPublicUrl, initial.snapshot.id), apiPublicUrl, initial);
  const playback = usePlayback(live.moves.length, !live.finished);
  const positions = useMemo(() => positionsFrom(live.moves.map((move) => move.uci)), [live.moves]);

  const snapshot = live.snapshot;
  const active = !live.finished;
  // Replaying the moves is what gives each piece the identity that makes it
  // slide, so the snapshot's FEN is only worth falling back to while the list
  // is provably short — and only once the cursor has caught up with it, since
  // every earlier ply of a short list is still sound.
  const fromSnapshot = live.gap && playback.ply >= live.moves.length;
  const position = fromSnapshot ? positionFromFen(snapshot.fen) : (positions[playback.ply] ?? startingPosition());
  const shownPly = fromSnapshot ? snapshot.ply : playback.ply;
  const shown = fromSnapshot ? undefined : live.moves[playback.ply - 1];
  const lastMove = shown === undefined ? null : { from: shown.uci.slice(0, 2), to: shown.uci.slice(2, 4) };
  // The rejection that preceded the move on screen, so it reappears on every
  // replay instead of scrolling away once in the feed.
  const mark = fromSnapshot ? null : markForPly(live.attempts, playback.ply);

  // Everything the spectator sees is read from the cursor; the truth is only
  // how far there is left to catch up. The clocks are the one exception, in
  // player() above: freezing them whenever the cursor is not exactly at the
  // live edge would freeze them permanently, since being a ply or two behind
  // is the normal state of paced viewing.
  const arrived = playback.ply >= live.moves.length;
  const revealed = live.finished && arrived;
  // A live game's move list is trimmed, because nobody knows the future. A
  // finished game's is not: everyone knows the outcome and the complete score
  // sheet is the point.
  const shownMoves = live.finished ? live.moves : live.moves.slice(0, playback.ply);

  function player(color: "white" | "black"): ReactElement {
    const agent = color === "white" ? snapshot.white : snapshot.black;
    // The clock runs while the cursor is chasing the live edge, not only when
    // it is exactly there: being a ply or two behind is the normal state of
    // paced viewing, and freezing it there would freeze it for ever. It stops
    // when the viewer parks on a move, because rewinding is not a pause.
    const running = active && snapshot.turn === color && playback.following;
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
        <span className={revealed ? "hud" : "hud hud--live"}>
          {revealed ? null : <span className="live-dot" aria-hidden="true" />}
          {revealed ? "Finished" : "Live"} · {snapshot.config.rated ? "rated" : "training"} ·{" "}
          {Math.round(snapshot.config.timePerMoveMs / 1000)} s per move
        </span>
        <span className="hud hud--right">
          move {Math.floor(shownPly / 2) + 1} · {shownPly} plies
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
              <div className="board-views" onKeyDown={playback.onKeyDown}>
                <Board2D
                  position={position}
                  lastMove={lastMove}
                  mark={mark}
                  label={`Board after ${shownPly} ${shownPly === 1 ? "ply" : "plies"}`}
                />
              </div>
              <div className="files" aria-hidden="true">
                {FILES.map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
            </div>
            {player("white")}
            <PlaybackBar playback={playback} active={!live.finished} />
            <p className="board-hint">
              Arrow keys step through the moves, space plays and pauses, End returns to the{" "}
              {live.finished ? "final" : "live"} position.
            </p>
          </div>

          <div className="side">
            <aside className="movelist-panel" aria-label="Moves">
              <p className="panel-title">Moves</p>
              <MoveList
                moves={shownMoves.map((move) => ({
                  ply: move.ply,
                  color: move.color,
                  san: move.san,
                  thinkTimeMs: move.thinkTimeMs,
                }))}
                selectedPly={playback.ply}
                onSelect={playback.setPly}
              />
              {/* The transport under the board owns the way back; this line
                  only says where the cursor is. */}
              <p className="panel-foot">
                {playback.atLive
                  ? active
                    ? "Following live"
                    : "Final position"
                  : `Showing ply ${playback.ply} of ${playback.total}`}
              </p>
            </aside>
          </div>
        </div>

        <div className="feeds">
          <CommentFeed
            color="white"
            name={snapshot.white.name}
            moves={live.moves}
            attempts={live.attempts}
            throughPly={playback.ply}
          />
          <CommentFeed
            color="black"
            name={snapshot.black.name}
            moves={live.moves}
            attempts={live.attempts}
            throughPly={playback.ply}
          />
        </div>

        {revealed ? (
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
