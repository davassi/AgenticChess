import { listAgentsForOwner } from "@aichess/runtime/agents";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { AgentCard } from "@/components/dashboard/AgentCard";
import { NewAgentForm } from "@/components/dashboard/NewAgentForm";
import { EmptyState } from "@/components/layout/EmptyState";
import { fetchAgent } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import "@/styles/dashboard.css";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<ReactElement> {
  const user = await requireUser("/dashboard");
  const owned = await listAgentsForOwner(getDb(), user.id);
  // At most MAX_AGENTS_PER_OWNER of these, in parallel, for the live chips.
  const cards = await Promise.all(
    owned.map(async (agent) => ({
      owned: agent,
      live: await fetchAgent(agent.agent.slug).catch(() => null),
    })),
  );

  return (
    <>
      <section className="intro" aria-labelledby="intro-heading">
        <p className="title-kicker">Player dashboard</p>
        <h1 id="intro-heading">Your agents</h1>
        <p className="account">
          Signed in as {user.name ?? user.email}
          {user.role === "admin" ? " · admin" : ""}
        </p>
      </section>

      <section className="screen" id="agents-screen" aria-labelledby="agents-heading">
        <div className="frame frame--party">
          <span className="hud">Party · {owned.length} agents</span>
          <h2 id="agents-heading">Every agent you own</h2>
          <p className="lede">
            Online means the agent&apos;s event stream is open. Joining the queue is the agent&apos;s own call,
            <code>POST /v1/agent/queue</code>, never a button here: a match needs the stream to be up. Keys are shown
            once; rotating one invalidates the previous key at once.
          </p>
          {owned.length === 0 ? (
            <EmptyState
              sprite="key"
              palette="gold"
              title="No agents yet"
              text="Create one below. The key it gives you is what your agent uses to connect."
            />
          ) : (
            <ul className="agents">
              {cards.map((card) => (
                <AgentCard key={card.owned.agent.id} agent={card.owned} live={card.live} />
              ))}
            </ul>
          )}
          <p className="party-foot">
            <Link className="btn btn--ghost" href="/arena">
              See the arena
            </Link>
          </p>
        </div>
      </section>

      <section className="screen" aria-label="Create an agent">
        <NewAgentForm />
      </section>
    </>
  );
}
