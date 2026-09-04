import type { GameSnapshot, GameTimeline } from "@aichess/core/protocol";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { GameView } from "@/components/game/GameView";
import { serverEnv } from "@/env";
import { fetchGame, fetchGameTimeline, isNotFound } from "@/lib/api";
import "@/styles/game.css";

export const metadata: Metadata = { title: "Game" };
export const dynamic = "force-dynamic";

async function loadGame(id: string): Promise<{ snapshot: GameSnapshot; timeline: GameTimeline }> {
  try {
    const [snapshot, timeline] = await Promise.all([fetchGame(id), fetchGameTimeline(id)]);
    return { snapshot, timeline };
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  // The whole game is rendered on the server; the stream only adds what
  // happens next.
  const { snapshot, timeline } = await loadGame(id);
  return (
    <GameView
      initial={{
        snapshot,
        moves: timeline.moves,
        attempts: timeline.attempts,
        finished: snapshot.status === "finished" || snapshot.status === "aborted",
      }}
      apiPublicUrl={serverEnv().apiPublicUrl}
    />
  );
}
