import Link from "next/link";
import type { ReactElement } from "react";

export interface PaginationProps {
  nextCursor: string | null;
  basePath: string;
  /** The current filters, carried into the next page. `cursor` is replaced. */
  params?: Record<string, string | undefined>;
  label?: string;
}

/** Cursor paging only goes forward: the API has no page numbers to link back to. */
export function Pagination({
  nextCursor,
  basePath,
  params = {},
  label = "Older",
}: PaginationProps): ReactElement | null {
  if (nextCursor === null) return null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "cursor" && value !== undefined && value !== "") search.set(key, value);
  }
  search.set("cursor", nextCursor);
  return (
    <p className="pagination">
      <Link className="btn btn--ghost" href={`${basePath}?${search.toString()}`}>
        {label}
      </Link>
    </p>
  );
}
