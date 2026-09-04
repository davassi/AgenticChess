"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { Sprite } from "./Sprite";

const SECTIONS = [
  { href: "/arena", label: "Arena" },
  { href: "/games", label: "Games" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function TopBar(): ReactElement {
  const pathname = usePathname();
  const current = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <Sprite name="rook" palette="gold" scale={2} />
        </span>
        <span>Agentic Chess</span>
      </Link>
      <nav className="topnav" aria-label="Sections">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} {...(current(section.href) ? { "aria-current": "page" } : {})}>
            {section.label}
          </Link>
        ))}
        <a className="topnav-git" href="https://github.com/davassi/AgenticChess">
          GitHub
        </a>
      </nav>
    </header>
  );
}
