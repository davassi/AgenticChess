import type { AgentProfile } from "@aichess/core/protocol";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { AgentHeader } from "@/components/agents/AgentHeader";
import { AgentStats } from "@/components/agents/AgentStats";
import { RatingCurve } from "@/components/agents/RatingCurve";
import { GameRow } from "@/components/games/GameRow";
import { EmptyState } from "@/components/layout/EmptyState";
import { fetchAgent, isMissingOrMalformed } from "@/lib/api";
import "@/styles/agent.css";

export const dynamic = "force-dynamic";

async function loadProfile(slug: string): Promise<AgentProfile> {
  try {
    return await fetchAgent(slug);
  } catch (error) {
    if (isMissingOrMalformed(error)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const profile = await fetchAgent(slug);
    return { title: profile.agent.name, description: profile.description };
  } catch {
    return { title: "Agent" };
  }
}

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactElement> {
  const { slug } = await params;
  const profile = await loadProfile(slug);

  return (
    <>
      <section className="intro" aria-labelledby="intro-heading">
        <p className="title-kicker">Agent profile</p>
        <h1 id="intro-heading">{profile.agent.name}</h1>
        <p className="intro-lede">
          {profile.agent.modelProvider} · {profile.agent.modelName}
        </p>
      </section>

      <AgentHeader profile={profile} />

      <section className="screen" id="curve-screen" aria-labelledby="curve-heading">
        <div className="frame">
          <span className="hud">Rating curve · Glicko-2</span>
          <h2 id="curve-heading">Every rated game, oldest to newest</h2>
          <RatingCurve points={profile.ratingHistory} rating={profile.rating} />
        </div>
      </section>

      <section className="screen" id="stats-screen" aria-labelledby="stats-heading">
        <div className="frame frame--scores">
          <span className="hud">Statistics</span>
          <h2 id="stats-heading">The numbers behind the rating</h2>
          <AgentStats stats={profile.stats} />
        </div>
      </section>

      <section className="screen" id="games-screen" aria-labelledby="games-heading">
        <div className="frame frame--scores">
          <span className="hud">Records · Recent games</span>
          <h2 id="games-heading">The last games</h2>
          {profile.recentGames.length === 0 ? (
            <EmptyState
              compact
              sprite="scroll"
              title="No games yet"
              text="This agent has not played in the arena."
              actions={[{ href: "/arena", label: "See the arena", primary: true }]}
            />
          ) : (
            <div className="table-scroll">
              <table className="scores archive">
                <thead>
                  <tr>
                    <th scope="col">Game</th>
                    <th scope="col">When</th>
                    <th scope="col">White</th>
                    <th scope="col">Black</th>
                    <th scope="col">Result</th>
                    <th scope="col">Ending</th>
                    <th scope="col">Plies</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recentGames.map((game) => (
                    <GameRow key={game.id} game={game} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
