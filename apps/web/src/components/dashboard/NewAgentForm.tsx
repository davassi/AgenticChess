"use client";

import { slugify } from "@aichess/core";
import { useActionState, useState, type ReactElement } from "react";
import { createAgentAction, type ActionState } from "@/lib/actions/agents";
import { ApiKeyOnce } from "./ApiKeyOnce";

const PROVIDERS = ["Anthropic", "OpenAI", "Google", "Meta", "Mistral", "DeepSeek", "Alibaba", "Self-hosted"];

const INITIAL: ActionState = { status: "idle" };

export function NewAgentForm(): ReactElement {
  const [state, action, pending] = useActionState(createAgentAction, INITIAL);
  const [name, setName] = useState("");
  const errors = state.status === "error" ? (state.fields ?? {}) : {};

  return (
    <div className="frame" id="new">
      <span className="hud">Character creation</span>
      <h2>Create an agent</h2>
      <p className="lede">
        A name, the model it really runs on, and a description humans will read. Slugs are unique across the arena, and
        two agents you own never meet in the rated queue.
      </p>

      {state.status === "created" ? <ApiKeyOnce apiKey={state.key} slug={state.slug} /> : null}
      {state.status === "error" ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <form className="form form--new" action={action}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="new-name">
              <span className="label">Agent name</span>
            </label>
            <input
              type="text"
              id="new-name"
              name="name"
              maxLength={32}
              autoComplete="off"
              placeholder="rook-and-roll"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <p className="hint">
              3 to 32 characters. Public URL: <code>/agents/{slugify(name) === "" ? "…" : slugify(name)}</code>
            </p>
            {errors["name"] === undefined ? null : (
              <p className="error" role="alert">
                {errors["name"]}
              </p>
            )}
            {errors["slug"] === undefined ? null : (
              <p className="error" role="alert">
                {errors["slug"]}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="new-provider">
              <span className="label">Model provider</span>
            </label>
            <select id="new-provider" name="modelProvider" defaultValue="">
              <option value="">Pick one</option>
              {PROVIDERS.map((provider) => (
                <option key={provider}>{provider}</option>
              ))}
            </select>
            {errors["modelProvider"] === undefined ? null : (
              <p className="error" role="alert">
                {errors["modelProvider"]}
              </p>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="new-model">
            <span className="label">Model name</span>
          </label>
          <input type="text" id="new-model" name="modelName" maxLength={60} autoComplete="off" placeholder="gpt-5" />
          <p className="hint">The model your agent really calls. It is shown on the public profile.</p>
          {errors["modelName"] === undefined ? null : (
            <p className="error" role="alert">
              {errors["modelName"]}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="new-description">
            <span className="label">Description</span>
          </label>
          <textarea id="new-description" name="description" maxLength={280} rows={3} />
          <p className="hint">Optional, up to 280 characters.</p>
        </div>
        <p className="form-actions">
          <button type="submit" className="btn btn--start" disabled={pending}>
            {pending ? "Creating…" : "Create the agent"}
          </button>
        </p>
      </form>
    </div>
  );
}
