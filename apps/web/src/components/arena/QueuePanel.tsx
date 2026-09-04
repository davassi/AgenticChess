import type { AgentSummary, QueueEntryPublic } from "@aichess/core/protocol";
import type { ReactElement } from "react";
import { AgentCell } from "@/components/layout/AgentCell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Sprite } from "@/components/layout/Sprite";
import type { PaletteName, SpriteName } from "@/lib/pixel";

export interface QueuePanelProps {
  queue: QueueEntryPublic[];
  playing: AgentSummary[];
  idle: AgentSummary[];
  offline: AgentSummary[];
  /** Only for tests; the wait is measured against the real clock otherwise. */
  now?: number;
}

interface RoomProps {
  title: string;
  sprite: SpriteName;
  palette: PaletteName;
  scale?: number;
  modifier: string;
  children: ReactElement[];
}

function Room({ title, sprite, palette, scale = 2, modifier, children }: RoomProps): ReactElement {
  return (
    <section className={`room room--${modifier}`} aria-label={title}>
      <p className="panel-title">
        <Sprite name={sprite} palette={palette} scale={scale} />
        {title} · {children.length}
      </p>
      <ul className="roster">{children}</ul>
    </section>
  );
}

function waited(queuedAt: string, now?: number): string {
  const seconds = Math.max(0, Math.round(((now ?? Date.now()) - Date.parse(queuedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`;
}

export function QueuePanel({ queue, playing, idle, offline, now }: QueuePanelProps): ReactElement {
  if (queue.length === 0 && playing.length === 0 && idle.length === 0) {
    return (
      <EmptyState
        sprite="moon"
        palette="slate"
        kicker="Waiting room"
        title="Nobody is in the arena"
        text="An agent is online while its event stream is open. Register one and connect it to fill this room."
        actions={[{ href: "/signin", label: "Register an agent", primary: true }]}
      />
    );
  }
  return (
    <div className="rooms">
      <Room title="In queue" sprite="hourglass" palette="gold" modifier="queue">
        {queue.map((entry) => (
          <li key={entry.agent.id}>
            <AgentCell
              agent={entry.agent}
              extra={`${Math.round(entry.rating)} · waiting ${waited(entry.queuedAt, now)}`}
            />
          </li>
        ))}
      </Room>
      <Room title="Playing" sprite="bolt" palette="magenta" modifier="playing">
        {playing.map((agent) => (
          <li key={agent.id}>
            <AgentCell agent={agent} extra={agent.modelName} />
          </li>
        ))}
      </Room>
      <Room title="Online, not queued" sprite="plug" palette="lime" modifier="idle">
        {idle.map((agent) => (
          <li key={agent.id}>
            <AgentCell agent={agent} extra={agent.modelName} />
          </li>
        ))}
      </Room>
      <Room title="Offline" sprite="moon" palette="slate" scale={1} modifier="offline">
        {offline.map((agent) => (
          <li key={agent.id}>
            <AgentCell agent={agent} extra={agent.modelName} />
          </li>
        ))}
      </Room>
    </div>
  );
}
