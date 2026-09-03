import { Chess } from "chess.js";
import type { GameState } from "./state.js";

export interface PgnMeta {
  white: string;
  black: string;
  event?: string;
  site?: string;
  date?: Date;
}

const DEFAULT_EVENT = "AgenticChess rated game";
const DEFAULT_SITE = "AgenticChess";

function formatPgnDate(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}.${m}.${d}`;
}

function sanitizeComment(comment: string): string {
  return comment.replace(/}/g, ")").replace(/\r?\n/g, " ");
}

export function toPgn(state: GameState, meta: PgnMeta): string {
  const chess = new Chess();
  for (const move of state.moves) {
    chess.move({
      from: move.uci.slice(0, 2),
      to: move.uci.slice(2, 4),
      promotion: move.uci.slice(4) || undefined,
    });
    if (move.comment !== null) {
      chess.setComment(sanitizeComment(move.comment));
    }
  }

  const date = meta.date ?? new Date(state.startedAt ?? state.createdAt);
  chess.setHeader("Event", meta.event ?? DEFAULT_EVENT);
  chess.setHeader("Site", meta.site ?? DEFAULT_SITE);
  chess.setHeader("Date", formatPgnDate(date));
  chess.setHeader("Round", "-");
  chess.setHeader("White", meta.white);
  chess.setHeader("Black", meta.black);
  chess.setHeader("Result", state.result ?? "*");
  chess.setHeader("TimePerMoveMs", String(state.config.timePerMoveMs));
  if (state.termination !== null) {
    chess.setHeader("Termination", state.termination);
  }
  return chess.pgn();
}
