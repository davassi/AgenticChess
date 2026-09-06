"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { sendPageView } from "@/lib/beacon";

/**
 * The arena's own visit counter, and the only client component in the layout.
 * It follows the router rather than the request because the app router
 * navigates without reloading: a server-side count would see the first page and
 * then nothing, while prefetching would have it count pages nobody opened.
 */
export function PageViews(): null {
  const pathname = usePathname();

  useEffect(() => {
    sendPageView(pathname, "app");
  }, [pathname]);

  return null;
}
