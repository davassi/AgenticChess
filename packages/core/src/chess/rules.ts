import { Chess } from "chess.js";
import type { Color, GameResult, IllegalReason, Termination } from "../protocol/enums.js";
import { UCI_REGEX } from "../protocol/enums.js";
import type { LegalMove } from "../protocol/schemas.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ParsedMove = { san: string; uci: string; fenAfter: string };

export type BoardTermination = Extract<
  Termination,
  "checkmate" | "stalemate" | "threefold_repetition" | "fifty_move_rule" | "insufficient_material"
>;

const SAN_REGEX = /^(O-O(-O)?|[NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h](x[a-h])?[1-8](=?[NBRQ])?)[+#]?$/;
const FIFTY_MOVE_HALFMOVES = 100;
const REPETITIONS_FOR_DRAW = 3;

export function turnOf(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

export function legalMoves(fen: string): LegalMove[] {
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).map((m) => ({
    san: m.san,
    uci: `${m.from}${m.to}${m.promotion ?? ""}`,
  }));
}

function normalizeInput(raw: string): string {
  let s = raw.trim().replace(/[!?]+$/, "");
  s = s.replace(/^0-0-0$/i, "O-O-O").replace(/^0-0$/i, "O-O");
  s = s.replace(/^([a-h][1-8])-([a-h][1-8])([qrbn]?)$/i, "$1$2$3");
  return s;
}

function looksLikeMove(s: string): boolean {
  return UCI_REGEX.test(s.toLowerCase()) || SAN_REGEX.test(s);
}

export function tryMove(
  fen: string,
  input: string,
): { ok: true; move: ParsedMove } | { ok: false; reason: IllegalReason } {
  const s = normalizeInput(input);
  if (s.length === 0 || !looksLikeMove(s)) {
    return { ok: false, reason: "unparseable" };
  }
  const chess = new Chess(fen);
  try {
    const lower = s.toLowerCase();
    const move = UCI_REGEX.test(lower)
      ? chess.move({ from: lower.slice(0, 2), to: lower.slice(2, 4), promotion: lower.slice(4) || undefined })
      : chess.move(s);
    return {
      ok: true,
      move: {
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        fenAfter: chess.fen(),
      },
    };
  } catch {
    return { ok: false, reason: "not_legal" };
  }
}

export function normalizeFenForRepetition(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function detectBoardTermination(fen: string, fenHistory: readonly string[]): BoardTermination | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isInsufficientMaterial()) return "insufficient_material";

  const key = normalizeFenForRepetition(fen);
  let seen = 0;
  for (const past of fenHistory) {
    if (normalizeFenForRepetition(past) === key) seen += 1;
  }
  if (seen >= REPETITIONS_FOR_DRAW) return "threefold_repetition";

  const halfmoves = Number(fen.split(" ")[4] ?? "0");
  if (halfmoves >= FIFTY_MOVE_HALFMOVES) return "fifty_move_rule";

  return null;
}

export function resultForWinner(winner: Color): GameResult {
  return winner === "white" ? "1-0" : "0-1";
}
