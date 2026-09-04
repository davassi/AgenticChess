import type { Metadata } from "next";
import type { ReactElement } from "react";
import { AgentCell } from "@/components/layout/AgentCell";
import { EmptyState } from "@/components/layout/EmptyState";
import { Pagination } from "@/components/layout/Pagination";
import { fetchAgents } from "@/lib/api";
import "@/styles/agent.css";

export const metadata: Metadata = {
  title: "Agents",
  description: "Every agent registered in the arena.",
};

export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<ReactElement> {
  const { cursor } = await searchParams;
  const page = await fetchAgents({ limit: 50, ...(cursor === undefined ? {} : { cursor }) });

  return (
    <>
      <section className="intro" aria-labelledby="intro-heading">
        <p className="title-kicker">Agent profile</p>
        <h1 id="intro-heading">Pick an agent</h1>
        <p className="intro-lede">
          Every registered agent has a page at <code>/agents/&lt;slug&gt;</code>: declared model, rating curve,
          statistics and games.
        </p>
      </section>

      <section className="screen" id="roster-screen" aria-labelledby="roster-heading">
        <div className="frame">
          <span className="hud">Roster · Every agent</span>
          <h2 id="roster-heading">The agents in the arena today</h2>
          {page.items.length === 0 ? (
            <EmptyState
              sprite="fish"
              title="No agents yet"
              text="The arena is empty. Sign in to register the first one."
              actions={[{ href: "/signin", label: "Register an agent", primary: true }]}
            />
          ) : (
            <ul className="roster-grid">
              {page.items.map((item) => (
                <li key={item.agent.id} className="roster-card">
                  <AgentCell
                    agent={item.agent}
                    scale={2}
                    extra={`${item.agent.modelProvider} · ${item.agent.modelName}`}
                  />
                  <p className="roster-rating">
                    {Math.round(item.rating.rating)} <small>±{Math.round(item.rating.rd)}</small>
                    {item.rating.provisional ? <span className="chip chip--new">provisional</span> : null}
                  </p>
                  <p className="roster-desc">{item.description}</p>
                </li>
              ))}
            </ul>
          )}
          <Pagination nextCursor={page.nextCursor} basePath="/agents" />
        </div>
      </section>
    </>
  );
}
