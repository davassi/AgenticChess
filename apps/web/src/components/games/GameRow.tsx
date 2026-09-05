import type { GameListItem } from "@aichess/core/protocol";
import Link from "next/link";
import type { ReactElement } from "react";
import { AgentCell } from "@/components/layout/AgentCell";
import { timeAgo } from "@/lib/time";

const WON_BY: Record<string, string> = {
  checkmate: "won by checkmate",
  timeout: "won on time",
  resignation: "won by resignation",
  illegal_moves: "won on illegal moves",
  move_limit: "won on the move limit",
};

export function spaced(termination: string): string {
  return termination.replace(/_/g, " ");
}

/** One line saying how the game stands or how it ended. */
export function resultLabel(game: GameListItem): string {
  if (game.status === "created" || game.status === "active") {
    return game.turn === "white" ? "White to move" : "Black to move";
  }
  if (game.status === "aborted") return "Aborted";
  if (game.result === "1/2-1/2") return `Draw by ${spaced(game.termination ?? "agreement")}`;
  const winner = game.result === "1-0" ? game.white : game.black;
  const how = game.termination === null ? "won" : (WON_BY[game.termination] ?? `won by ${spaced(game.termination)}`);
  return `${winner.name} ${how}`;
}

export function GameRow({ game }: { game: GameListItem }): ReactElement {
  const live = game.status === "active" || game.status === "created";
  const winner = game.result === "1-0" ? "white" : game.result === "0-1" ? "black" : null;
  const when = game.finishedAt ?? game.startedAt ?? game.createdAt;
  return (
    <tr className={live ? "is-live" : undefined}>
      <td>
        <Link href={`/games/${game.id}`}>#{game.id.slice(0, 8)}</Link>
        {game.rated ? null : <span className="chip chip--training">training</span>}
      </td>
      <td>{live ? `live · move ${Math.floor(game.ply / 2) + 1}` : timeAgo(when)}</td>
      <td>
        <AgentCell agent={game.white} {...(winner === "white" ? { className: "is-winner" } : {})} />
      </td>
      <td>
        <AgentCell agent={game.black} {...(winner === "black" ? { className: "is-winner" } : {})} />
      </td>
      <td className="col-score">{live ? <span className="chip chip--live">live</span> : (game.result ?? "–")}</td>
      <td>{resultLabel(game)}</td>
      <td>{game.ply}</td>
      <td>
        <Link href={`/games/${game.id}`}>{live ? "Watch" : "Replay"}</Link>
      </td>
    </tr>
  );
}
