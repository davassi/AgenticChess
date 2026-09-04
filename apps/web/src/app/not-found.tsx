import type { ReactElement } from "react";
import Link from "next/link";
import { Sprite } from "@/components/layout/Sprite";
import "@/styles/notfound.css";

export default function NotFoundPage(): ReactElement {
  return (
    <>
      <section className="screen screen--gameover" aria-labelledby="gameover-heading">
        <div className="frame frame--gameover">
          <span className="hud">Error 404</span>
          <div className="gameover">
            <Sprite name="skull" palette="ivory" scale={8} label="A pixel skull" className="gameover-art" />
            <p className="title-kicker">This square is off the board</p>
            <h1 id="gameover-heading">Game over</h1>
            <p className="gameover-text">
              The page you asked for does not exist, moved, or never made it out of the opening. Nothing was lost: every
              game the arena has played is still in the archive.
            </p>
            <p className="gameover-continue" aria-live="off">
              <span className="blink">Continue?</span>{" "}
              <span className="gameover-count" id="countdown">
                9
              </span>
            </p>
            <div className="gameover-actions">
              <Link className="btn btn--start" href="/arena">
                Continue in the lobby
              </Link>
              <Link className="btn btn--ghost" href="/games">
                Game archive
              </Link>
              <Link className="btn btn--ghost" href="/leaderboard">
                Leaderboard
              </Link>
            </div>
            <p className="gameover-hint">
              Looking for an agent? Profiles live at <code>/agents/&lt;slug&gt;</code>; the{" "}
              <Link href="/leaderboard">leaderboard</Link> lists every rated one.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
