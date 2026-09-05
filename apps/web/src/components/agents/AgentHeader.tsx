import type { AgentProfile } from "@aichess/core/protocol";
import Link from "next/link";
import type { ReactElement } from "react";
import { Sprite } from "@/components/layout/Sprite";
import { avatarFor } from "@/lib/avatar";
import { timeAgo } from "@/lib/time";

export function AgentHeader({ profile }: { profile: AgentProfile }): ReactElement {
  const avatar = avatarFor(profile.agent.slug);
  return (
    <section className="screen" id="sheet" aria-labelledby="sheet-heading">
      <div className="frame frame--sheet">
        <span className="hud">Character sheet</span>
        <div className="sheet">
          <div className="sheet-art">
            <Sprite name={avatar.sprite} palette={avatar.palette} scale={5} label={`${profile.agent.name}'s piece`} />
          </div>
          <div className="sheet-id">
            <h2 id="sheet-heading">
              {profile.agent.name}
              {profile.agent.isHouse ? <span className="chip chip--house">house</span> : null}
              {profile.status === "suspended" ? <span className="chip chip--review">suspended</span> : null}
              {profile.rating.provisional ? <span className="chip chip--new">provisional</span> : null}
              {profile.online ? <span className="chip chip--live">online</span> : null}
              {profile.queue === null ? null : <span className="chip">in queue</span>}
            </h2>
            <dl className="facts">
              <div className="fact">
                <dt>Model</dt>
                <dd>
                  {profile.agent.modelProvider} · {profile.agent.modelName}
                </dd>
              </div>
              <div className="fact">
                <dt>Rating</dt>
                <dd>
                  {Math.round(profile.rating.rating)} <small>±{Math.round(profile.rating.rd)}</small>
                </dd>
              </div>
              <div className="fact">
                <dt>Rank</dt>
                <dd>{profile.rank === null ? "unranked" : `#${profile.rank}`}</dd>
              </div>
              <div className="fact">
                <dt>Registered</dt>
                <dd>{timeAgo(profile.createdAt)}</dd>
              </div>
            </dl>
            {profile.description === "" ? null : <p className="sheet-desc">{profile.description}</p>}
            <div className="sheet-actions">
              {profile.activeGameId === null ? null : (
                <Link className="btn btn--start" href={`/games/${profile.activeGameId}`}>
                  Watch the live game
                </Link>
              )}
              <Link className="btn btn--ghost" href={`/games?agent=${profile.agent.slug}`}>
                All games
              </Link>
              {/* The report button and the flag notice arrive with roadmap step 6,
                  together with the agent_flags table they write to. */}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
