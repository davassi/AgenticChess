import type { RatingPoint, RatingSummary } from "@aichess/core/protocol";
import type { ReactElement } from "react";
import { EmptyState } from "@/components/layout/EmptyState";
import { buildRatingCurve } from "@/lib/curve";

export interface RatingCurveProps {
  points: RatingPoint[];
  rating: RatingSummary;
}

/** Server-rendered SVG: the line is the rating, the band is the deviation. */
export function RatingCurve({ points, rating }: RatingCurveProps): ReactElement {
  const curve = buildRatingCurve(points.map((point) => ({ rating: point.rating, rd: point.rd })));
  if (curve === null) {
    return (
      <EmptyState
        compact
        sprite="hourglass"
        palette="cyan"
        title="No rated games yet"
        text="The curve appears after the first game that changes this agent's rating."
      />
    );
  }
  return (
    <figure className="curve">
      <div className="curve-plot">
        <svg
          viewBox={`0 0 ${curve.width} ${curve.height}`}
          role="img"
          aria-label={`Rating after each game with its deviation band, ending at ${Math.round(curve.last.rating)} with a deviation of ${Math.round(rating.rd)}`}
        >
          <defs>
            <clipPath id={curve.clipId}>
              <rect x={46} y={14} width={curve.width - 62} height={curve.height - 40} />
            </clipPath>
          </defs>
          {curve.gridLines.map((line) => (
            <g key={line.value}>
              <line
                x1={46}
                x2={curve.width - 16}
                y1={line.y}
                y2={line.y}
                stroke={line.emphasis ? "#b7abd8" : "#3b2d63"}
                strokeWidth={1}
              />
              <text x={40} y={line.y + 3} textAnchor="end" fontSize={9} fill="#b7abd8">
                {line.value}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${curve.clipId})`}>
            <path d={curve.band} fill="rgba(95, 242, 255, 0.14)" />
          </g>
          {curve.ratedX === null ? null : (
            <g>
              <line
                x1={curve.ratedX}
                x2={curve.ratedX}
                y1={14}
                y2={curve.height - 26}
                stroke="#9dff5a"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
              <text x={curve.ratedX + 5} y={26} fontSize={9} fill="#9dff5a">
                rated
              </text>
            </g>
          )}
          <path d={curve.line} fill="none" stroke="#5ff2ff" strokeWidth={2} shapeRendering="crispEdges" />
          <rect
            x={curve.last.x - 4}
            y={curve.last.y - 4}
            width={8}
            height={8}
            fill="#ffc233"
            stroke="#0b0716"
            strokeWidth={2}
          />
          {curve.xLabels.map((label) => (
            <text key={label.n} x={label.x} y={curve.height - 8} textAnchor="middle" fontSize={9} fill="#b7abd8">
              {label.n}
            </text>
          ))}
        </svg>
      </div>
      <figcaption className="curve-tip">
        {points.length} rated {points.length === 1 ? "game" : "games"}. The band is the deviation: it starts at ±350 and
        the agent reaches the public board under ±110.
      </figcaption>
    </figure>
  );
}
