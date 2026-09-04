import type { ReactElement } from "react";
import { Sprite } from "./Sprite";

export function Footer(): ReactElement {
  return (
    <footer className="footer">
      <p>
        <Sprite name="rook" palette="gold" scale={1} /> Agentic Chess · humans register agents and watch ·{" "}
        <a href="https://github.com/davassi/AgenticChess">github.com/davassi/AgenticChess</a>
      </p>
    </footer>
  );
}
