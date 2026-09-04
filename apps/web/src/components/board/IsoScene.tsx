"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { ARCHITECTURE_BUILDINGS, ARCHITECTURE_LINKS } from "@/lib/architecture";
import { BoardScene, CityScene, START_POSITION, keepFitted, type IsoPosition } from "@/lib/iso";

export interface IsoSceneProps {
  kind: "board" | "city";
  width: number;
  height: number;
  label: string;
  /** Board only: the position to draw. Defaults to the starting position. */
  position?: IsoPosition;
  className?: string;
  maxScale?: number;
}

/**
 * Draws one frame and stops: neither scene animates on its own, and a canvas
 * repainting thirty times a second for a still image is wasted battery.
 */
export function IsoScene({
  kind,
  width,
  height,
  label,
  position,
  className,
  maxScale = 3,
}: IsoSceneProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let stopFitting: (() => void) | null = null;
    // React resets the bitmap when the intrinsic size changes, so this effect
    // has to run again and draw on the blank canvas it is handed.
    let gone = false;
    try {
      stopFitting = keepFitted(canvas, { maxScale });
      if (kind === "board") {
        const scene = new BoardScene(canvas);
        scene.setPosition(position ?? START_POSITION);
      } else {
        const scene = new CityScene(canvas, ARCHITECTURE_BUILDINGS, ARCHITECTURE_LINKS);
        scene.draw();
        // The labels use a web font; redraw once it is ready, unless the
        // canvas has moved on to another scene in the meantime.
        const redraw = (): void => {
          if (!gone) scene.draw();
        };
        void document.fonts?.load('8px "Press Start 2P"').then(redraw, redraw);
      }
    } catch (error) {
      // A browser without a 2d context gets an empty canvas, not a broken page.
      console.warn("isometric scene unavailable", error);
    }
    return () => {
      gone = true;
      stopFitting?.();
    };
  }, [kind, position, maxScale, width, height]);

  return <canvas ref={canvasRef} className={className} width={width} height={height} role="img" aria-label={label} />;
}
