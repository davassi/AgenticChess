import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import type { PaletteName, SpriteName } from "@/lib/pixel";
import { Sprite } from "./Sprite";

export interface EmptyStateAction {
  href: string;
  label: string;
  primary?: boolean;
}

export interface EmptyStateProps {
  title: string;
  kicker?: string;
  text?: ReactNode;
  sprite?: SpriteName;
  palette?: PaletteName;
  scale?: number;
  actions?: EmptyStateAction[];
  compact?: boolean;
}

/** The prototype's empty screen: every dead end is a screen of the same game. */
export function EmptyState({
  title,
  kicker,
  text,
  sprite = "skull",
  palette = "ivory",
  scale,
  actions = [],
  compact = false,
}: EmptyStateProps): ReactElement {
  return (
    <div className={compact ? "empty-screen empty-screen--compact" : "empty-screen"} role="status">
      <span className="empty-art">
        <Sprite name={sprite} palette={palette} scale={scale ?? (compact ? 3 : 5)} />
      </span>
      {kicker === undefined ? null : <p className="empty-kicker">{kicker}</p>}
      <p className="empty-title">{title}</p>
      {text === undefined ? null : <p className="empty-text">{text}</p>}
      {actions.length === 0 ? null : (
        <p className="empty-actions">
          {actions.map((action) => (
            <Link key={action.href} className={action.primary ? "btn btn--start" : "btn btn--ghost"} href={action.href}>
              {action.label}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}
