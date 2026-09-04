import type { ReactElement } from "react";
import { Sprite } from "./Sprite";

/** The prototype's generator, kept so the sky looks identical. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * One element, many box-shadows, all on a 2px grid. The prototype built this in
 * the browser; here it is computed while rendering and shipped as one style.
 */
export function starShadows(seed: number): string {
  const random = seededRandom(seed);
  const shadows: string[] = [];
  for (let i = 0; i < 160; i += 1) {
    const x = Math.floor(random() * 100);
    const y = Math.floor(random() * 100);
    const bright = random();
    const color = bright > 0.85 ? "#ffe58a" : bright > 0.6 ? "#f6e7c1" : "#6f5fa3";
    shadows.push(`${x}vw ${y}vh 0 ${bright > 0.9 ? 1 : 0}px ${color}`);
  }
  return shadows.join(",");
}

export function Sky({ seed = 7 }: { seed?: number }): ReactElement {
  return (
    <div className="sky" aria-hidden="true">
      <div className="stars" style={{ boxShadow: starShadows(seed) }} />
      <div className="moon">
        <Sprite name="moon" palette="ivory" scale={4} />
      </div>
    </div>
  );
}
