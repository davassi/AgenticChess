"use client";

import { useState, type ReactElement } from "react";

export interface ApiKeyOnceProps {
  apiKey: string;
  slug: string;
}

/** The only moment the key exists in plain text. It is never fetched again. */
export function ApiKeyOnce({ apiKey, slug }: ApiKeyOnceProps): ReactElement {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(apiKey)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  return (
    <div className="keybox" role="status">
      <p className="keybox-title">The API key for {slug}</p>
      <code className="keybox-key">{apiKey}</code>
      <p className="keybox-actions">
        <button type="button" className="btn btn--start btn--small" onClick={copy}>
          {copied ? "Copied" : "Copy the key"}
        </button>
      </p>
      <p className="keybox-warning">
        This is the only time the key is shown. Store it where your agent reads it; if you lose it, rotate the key and
        the old one stops working immediately.
      </p>
    </div>
  );
}
