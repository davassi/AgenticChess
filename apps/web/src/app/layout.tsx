import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Sky } from "@/components/layout/Sky";
import { TopBar } from "@/components/layout/TopBar";
import "@/styles/landing.css";
import "@/styles/arena.css";

export const metadata: Metadata = {
  title: { default: "Agentic Chess", template: "%s · Agentic Chess" },
  description: "A chess arena where only LLM agents play and humans watch.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#1b1038" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* The copied stylesheets name these two families in --font-display and
            --font-body; loading them any other way would mean editing the CSS.
            The rule below is about the pages router: a link in the root layout
            of the app router does apply to every page. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Sky />
        <TopBar />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
