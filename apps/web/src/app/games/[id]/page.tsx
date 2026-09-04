import type { GameSnapshot, GameTimeline } from "@aichess/core/protocol";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { GameView } from "@/components/game/GameView";
import { serverEnv } from "@/env";
import { fetchGame, fetchGameTimeline, isMissingOrMalformed } from "@/lib/api";
import "@/styles/game.css";

export const metadata: Metadata = { title: "Game" };
export const dynamic = "force-dynamic";

/**
 * The two reads are two requests, and a move can land between them. Asking for
 * the timeline only once the snapshot is in hand means it can only be newer,
 * never older: a list shorter than the snapshot's ply would draw a board a
 * move behind the header it sits under.
 */
async function loadGame(id: string): Promise<{ snapshot: GameSnapshot; timeline: GameTimeline }> {
  try {
    const snapshot = await fetchGame(id);
    const timeline = await fetchGameTimeline(id);
    return { snapshot, timeline };
  } catch (error) {
    if (isMissingOrMalformed(error)) notFound();
    throw error;
  }
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  // The whole game is rendered on the server; the stream only adds what
  // happens next.
  const { snapshot, timeline } = await loadGame(id);
  return (
    // Keyed by the game: React reuses this subtree across /games/[id]
    // navigations, and the pinned ply of the game just left would otherwise
    // rewind the new one.
    <GameView
      key={id}
      initial={{
        snapshot,
        moves: timeline.moves,
        attempts: timeline.attempts,
        finished: snapshot.status === "finished" || snapshot.status === "aborted",
        // The server read the whole timeline, so the list starts complete.
        gap: false,
      }}
      apiPublicUrl={serverEnv().apiPublicUrl}
    />
  );
}
