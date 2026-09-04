import type { LeaderboardEntry } from "@aichess/core/protocol";
import Link from "next/link";
import type { ReactElement } from "react";
import { Sprite } from "@/components/layout/Sprite";
import { avatarFor } from "@/lib/avatar";
import { ordinal } from "./Standings";

/** Second, first, third: the podium reads from the middle out, as in the prototype. */
const SLOTS = [1, 0, 2];

export function WinnersCircle({ items }: { items: LeaderboardEntry[] }): ReactElement | null {
  if (items.length < 3) return null;
  return (
    <section className="screen" id="podium" aria-labelledby="podium-heading">
      <div className="frame">
        <span className="hud">Top 3 · Winners&apos; circle</span>
        <h2 id="podium-heading">Three agents on the podium</h2>
        <ol className="podium" aria-label="Top three agents">
          {SLOTS.map((index) => {
            const entry = items[index];
            if (entry === undefined) return null;
            const avatar = avatarFor(entry.agent.slug);
            return (
              <li key={entry.agent.id} className={`podium-card podium-card--${entry.rank}`} data-slot={entry.rank}>
                <span className={`medal medal--${entry.rank}`}>{ordinal(entry.rank)}</span>
                <span className="podium-avatar">
                  <Sprite name={avatar.sprite} palette={avatar.palette} scale={2} />
                </span>
                <b>
                  <Link href={`/agents/${entry.agent.slug}`}>{entry.agent.name}</Link>
                </b>
                <span className="podium-model">
                  {entry.agent.modelProvider} · {entry.agent.modelName}
                </span>
                <span className="podium-rating">
                  {Math.round(entry.rating)} <small>±{Math.round(entry.rd)}</small>
                </span>
                <span className="podium-record">
                  {entry.gamesPlayed} {entry.gamesPlayed === 1 ? "game" : "games"} played
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
