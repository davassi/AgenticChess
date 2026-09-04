import { GLICKO2_DEFAULTS, PROVISIONAL_RD_THRESHOLD } from "@aichess/core";

export interface CurvePoint {
  rating: number;
  rd: number;
}

export interface GridLine {
  value: number;
  y: number;
  /** 1500 is the line every agent starts on. */
  emphasis: boolean;
}

export interface RatingCurve {
  width: number;
  height: number;
  /** The rating after each game, as an SVG path. */
  line: string;
  /** The deviation band around it, closed. */
  band: string;
  gridLines: GridLine[];
  xLabels: Array<{ n: number; x: number }>;
  /** Where the deviation first drops under the rated threshold, if it has. */
  ratedX: number | null;
  last: { x: number; y: number; rating: number };
  clipId: string;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { l: 46, r: 16, t: 14, b: 26 };

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The prototype's geometry, kept: the series starts at the Glicko-2 defaults
 * so a first game reads as a move away from 1500, not as a flat line.
 * Returns null when there is nothing to draw yet.
 */
export function buildRatingCurve(history: CurvePoint[]): RatingCurve | null {
  if (history.length === 0) return null;
  const series: CurvePoint[] = [{ rating: GLICKO2_DEFAULTS.rating, rd: GLICKO2_DEFAULTS.rd }, ...history];
  const innerW = WIDTH - PAD.l - PAD.r;
  const innerH = HEIGHT - PAD.t - PAD.b;
  const n = Math.max(1, series.length - 1);
  const ratings = series.map((point) => point.rating);
  const lo = Math.floor((Math.min(...ratings) - 40) / 50) * 50;
  const hiRaw = Math.ceil((Math.max(...ratings) + 40) / 50) * 50;
  const hi = hiRaw === lo ? lo + 50 : hiRaw;
  const x = (index: number): number => PAD.l + (index / n) * innerW;
  const y = (value: number): number => PAD.t + innerH - ((value - lo) / (hi - lo)) * innerH;

  const upper = series.map((point, index) => `${round(x(index))},${round(y(point.rating + point.rd))}`);
  const lower = series.map((point, index) => `${round(x(index))},${round(y(point.rating - point.rd))}`).reverse();
  const band = `M${upper.join(" L")} L${lower.join(" L")} Z`;
  const line = series
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(x(index))},${round(y(point.rating))}`)
    .join(" ");

  const tickStep = hi - lo > 400 ? 100 : 50;
  const gridLines: GridLine[] = [];
  for (let value = lo; value <= hi; value += tickStep) {
    gridLines.push({ value, y: round(y(value)), emphasis: value === GLICKO2_DEFAULTS.rating });
  }

  const xStep = n > 30 ? 10 : n > 12 ? 5 : 1;
  const xLabels: Array<{ n: number; x: number }> = [];
  for (let index = 0; index <= n; index += xStep) {
    xLabels.push({ n: index, x: round(x(index)) });
  }

  const ratedIndex = series.findIndex((point) => point.rd <= PROVISIONAL_RD_THRESHOLD);
  const lastPoint = series[series.length - 1] ?? series[0];
  return {
    width: WIDTH,
    height: HEIGHT,
    line,
    band,
    gridLines,
    xLabels,
    ratedX: ratedIndex > 0 ? round(x(ratedIndex)) : null,
    last: {
      x: round(x(n)),
      y: round(y(lastPoint?.rating ?? GLICKO2_DEFAULTS.rating)),
      rating: lastPoint?.rating ?? GLICKO2_DEFAULTS.rating,
    },
    clipId: "curve-clip",
  };
}
