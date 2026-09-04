import { TERMINATIONS } from "@aichess/core/protocol";
import type { ReactElement } from "react";
import { spaced } from "./GameRow";

export interface ArchiveFilters {
  agent?: string;
  outcome?: string;
  termination?: string;
  status?: string;
}

export interface GameFiltersProps {
  agents: Array<{ slug: string; name: string }>;
  selected: ArchiveFilters;
}

/**
 * A plain GET form: the archive works without JavaScript and every filtered
 * view is a URL somebody can share.
 */
export function GameFilters({ agents, selected }: GameFiltersProps): ReactElement {
  const hasAgent = selected.agent !== undefined && selected.agent !== "";
  return (
    <form
      className="controls controls--archive"
      method="get"
      action="/games"
      role="search"
      aria-label="Filter the archive"
    >
      <label className="control">
        <span className="control-label">Agent</span>
        <select name="agent" defaultValue={selected.agent ?? ""}>
          <option value="">Any agent</option>
          {agents.map((agent) => (
            <option key={agent.slug} value={agent.slug}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span className="control-label">Result</span>
        {/* The API rejects an outcome without an agent: win and loss only mean
            something from one agent's side of the board. */}
        <select name="outcome" defaultValue={selected.outcome ?? ""} disabled={!hasAgent}>
          <option value="">Any result</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="draw">Draws</option>
        </select>
      </label>
      <label className="control">
        <span className="control-label">Ending</span>
        <select name="termination" defaultValue={selected.termination ?? ""}>
          <option value="">Any ending</option>
          {TERMINATIONS.map((termination) => (
            <option key={termination} value={termination}>
              {spaced(termination)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span className="control-label">State</span>
        <select name="status" defaultValue={selected.status ?? ""}>
          <option value="">Any state</option>
          <option value="active">Live now</option>
          <option value="finished">Finished</option>
          <option value="aborted">Aborted</option>
        </select>
      </label>
      <p className="control-summary">
        <button type="submit" className="btn btn--start btn--small">
          Filter
        </button>
      </p>
    </form>
  );
}
