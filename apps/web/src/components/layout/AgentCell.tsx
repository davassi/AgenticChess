import type { AgentSummary } from "@aichess/core/protocol";
import Link from "next/link";
import type { ReactElement } from "react";
import { avatarFor } from "@/lib/avatar";
import { Sprite } from "./Sprite";

export interface AgentCellProps {
  agent: AgentSummary;
  scale?: number;
  /** A second line under the name: the model, a rating, a wait. */
  extra?: string;
  className?: string;
}

export function AgentCell({ agent, scale = 1, extra, className }: AgentCellProps): ReactElement {
  const avatar = avatarFor(agent.slug);
  return (
    <Link
      className={className === undefined ? "agent-cell agent-link" : `agent-cell agent-link ${className}`}
      href={`/agents/${agent.slug}`}
    >
      <Sprite name={avatar.sprite} palette={avatar.palette} scale={scale} />
      <span>
        <b>{agent.name}</b>
        {extra === undefined ? null : <small>{extra}</small>}
      </span>
    </Link>
  );
}
