"use client";

import type { AgentProfile } from "@aichess/core/protocol";
import type { OwnedAgent } from "@aichess/runtime/agents";
import Link from "next/link";
import { useActionState, type ReactElement } from "react";
import { AgentCell } from "@/components/layout/AgentCell";
import { rotateKeyAction, type ActionState } from "@/lib/actions/agents";
import { timeAgo } from "@/lib/time";
import { ApiKeyOnce } from "./ApiKeyOnce";

export interface AgentCardProps {
  agent: OwnedAgent;
  /** The public profile, for the state the database alone cannot tell. */
  live: AgentProfile | null;
}

const INITIAL: ActionState = { status: "idle" };

export function AgentCard({ agent, live }: AgentCardProps): ReactElement {
  const [state, action, pending] = useActionState(rotateKeyAction, INITIAL);
  const rotated = state.status === "rotated" && state.slug === agent.agent.slug ? state : null;

  return (
    <li className="agent-card">
      <AgentCell agent={agent.agent} scale={2} extra={`${agent.agent.modelProvider} · ${agent.agent.modelName}`} />

      <p className="agent-chips">
        {agent.status === "suspended" ? <span className="chip chip--review">suspended</span> : null}
        {live?.online === true ? (
          <span className="chip chip--live">online</span>
        ) : (
          <span className="chip">offline</span>
        )}
        {live?.queue == null ? null : <span className="chip">in queue</span>}
        {live?.activeGameId == null ? null : (
          <Link className="chip chip--live" href={`/games/${live.activeGameId}`}>
            playing
          </Link>
        )}
        {agent.rating.provisional ? <span className="chip chip--new">provisional</span> : null}
      </p>

      <dl className="facts">
        <div className="fact">
          <dt>Rating</dt>
          <dd>
            {Math.round(agent.rating.rating)} <small>±{Math.round(agent.rating.rd)}</small>
          </dd>
        </div>
        <div className="fact">
          <dt>Games</dt>
          <dd>{agent.rating.gamesPlayed}</dd>
        </div>
        <div className="fact">
          <dt>Key</dt>
          <dd>
            <code>ac_{agent.apiKeyPrefix}…</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Created</dt>
          <dd>{timeAgo(agent.createdAt)}</dd>
        </div>
      </dl>

      {rotated === null ? null : <ApiKeyOnce apiKey={rotated.key} slug={agent.agent.slug} />}
      {state.status === "error" ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <p className="agent-actions">
        <Link className="btn btn--ghost btn--small" href={`/agents/${agent.agent.slug}`}>
          Public profile
        </Link>
        <form action={action}>
          <input type="hidden" name="agentId" value={agent.agent.id} />
          <input type="hidden" name="slug" value={agent.agent.slug} />
          <button type="submit" className="btn btn--ghost btn--small" disabled={pending}>
            {pending ? "Rotating…" : "Rotate the key"}
          </button>
        </form>
      </p>
    </li>
  );
}
