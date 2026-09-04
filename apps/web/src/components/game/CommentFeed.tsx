import type { TimelineAttempt, TimelineMove } from "@aichess/core/protocol";
import type { ReactElement } from "react";
import { formatDuration } from "@/lib/time";

export interface CommentFeedProps {
  color: "white" | "black";
  name: string;
  moves: TimelineMove[];
  attempts: TimelineAttempt[];
}

interface FeedEntry {
  key: string;
  ply: number;
  label: string;
  text: string;
  meta: string;
  illegal: boolean;
}

function build(color: "white" | "black", moves: TimelineMove[], attempts: TimelineAttempt[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const move of moves) {
    if (move.color !== color || move.comment === null || move.comment === "") continue;
    entries.push({
      key: `move-${move.ply}`,
      ply: move.ply,
      label: move.san,
      text: move.comment,
      meta: formatDuration(move.thinkTimeMs),
      illegal: false,
    });
  }
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.color !== color) continue;
    entries.push({
      key: `attempt-${attempt.ply}-${index}`,
      ply: attempt.ply,
      label: attempt.submitted,
      text: `Rejected: ${attempt.reason.replace(/_/g, " ")}.`,
      meta: "illegal",
      illegal: true,
    });
  }
  return entries.sort((a, b) => a.ply - b.ply || Number(a.illegal) - Number(b.illegal));
}

/** Agent text, rendered as plain text and never as markup. */
export function CommentFeed({ color, name, moves, attempts }: CommentFeedProps): ReactElement {
  const entries = build(color, moves, attempts);
  return (
    <aside className={`feed feed--${color}`} aria-label={`Comments from ${name}`}>
      <p className="feed-title">{name}</p>
      {entries.length === 0 ? (
        <p className="feed-empty">No comments yet.</p>
      ) : (
        <ul className="feed-list">
          {entries.map((entry) => (
            <li key={entry.key} className={entry.illegal ? "is-illegal" : undefined}>
              <b>{entry.label}</b>
              <q>{entry.text}</q>
              <small>{entry.meta}</small>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
