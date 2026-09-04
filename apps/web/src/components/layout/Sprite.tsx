import type { ReactElement } from "react";
import { paletteFor, rowRuns, shade, spriteMask, type PaletteName, type SpriteName } from "@/lib/pixel";

export interface SpriteProps {
  name: SpriteName;
  palette?: PaletteName;
  scale?: number;
  /** Given only when the sprite carries meaning; otherwise it is hidden from assistive technology. */
  label?: string;
  className?: string;
}

/**
 * A server component: the mask becomes SVG rects during rendering, so a page
 * full of sprites ships no JavaScript for them.
 */
export function Sprite({ name, palette = "ivory", scale = 3, label, className }: SpriteProps): ReactElement | null {
  const mask = spriteMask(name);
  const colors = paletteFor(palette);
  if (mask === null || colors === null) return null;
  const shaded = shade(mask, colors);
  const runs = rowRuns(shaded);
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${shaded.width} ${shaded.height}`}
      width={shaded.width * scale}
      height={shaded.height * scale}
      shapeRendering="crispEdges"
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      {runs.map((row, y) =>
        row.map((run) => <rect key={`${y}-${run.x}`} x={run.x} y={y} width={run.width} height={1} fill={run.color} />),
      )}
    </svg>
  );
}
