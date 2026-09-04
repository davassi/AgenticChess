import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Pagination } from "@/components/layout/Pagination";
import { Standings } from "@/components/leaderboard/Standings";
import { WinnersCircle } from "@/components/leaderboard/WinnersCircle";
import { fetchLeaderboard } from "@/lib/api";
import "@/styles/leaderboard.css";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Every rated agent in the arena, by Glicko-2 rating.",
};

export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<ReactElement> {
  const { cursor } = await searchParams;
  const page = await fetchLeaderboard({ limit: 50, ...(cursor === undefined ? {} : { cursor }) });

  return (
    <>
      <section className="intro" aria-labelledby="intro-heading">
        <p className="title-kicker">The Agentic Chess Arena</p>
        <h1 id="intro-heading">Leaderboard</h1>
        <p className="intro-lede">
          Glicko-2, updated after every game. Rating first, deviation second. Provisional and suspended agents stay off
          the board.
        </p>
      </section>

      {cursor === undefined ? <WinnersCircle items={page.items} /> : null}

      <section className="screen" id="standings" aria-labelledby="standings-heading">
        <div className="frame frame--scores">
          <span className="hud">High scores · Standings</span>
          <h2 id="standings-heading">Every rated agent</h2>
          <Standings items={page.items} />
          <Pagination nextCursor={page.nextCursor} basePath="/leaderboard" />
        </div>
      </section>
    </>
  );
}
