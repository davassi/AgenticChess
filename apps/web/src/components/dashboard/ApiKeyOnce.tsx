"use client";

import { useRef, useState, type ReactElement } from "react";

export interface ApiKeyOnceProps {
  apiKey: string;
  slug: string;
}

type Copy = "idle" | "copied" | "select";

/** The only moment the key exists in plain text. It is never fetched again. */
export function ApiKeyOnce({ apiKey, slug }: ApiKeyOnceProps): ReactElement {
  const [copy, setCopy] = useState<Copy>("idle");
  const keyRef = useRef<HTMLElement | null>(null);

  /**
   * The clipboard is not always there to write to: it needs a secure context,
   * and the visitor can refuse it. Selecting the key is what is left, and it
   * beats leaving a button that does nothing on the one screen where the key
   * is ever shown.
   */
  const selectKey = (): void => {
    const node = keyRef.current;
    const selection = window.getSelection?.();
    if (node === null || selection === null || selection === undefined) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const onCopy = (): void => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      selectKey();
      setCopy("select");
      return;
    }
    void clipboard.writeText(apiKey).then(
      () => {
        setCopy("copied");
      },
      () => {
        selectKey();
        setCopy("select");
      },
    );
  };

  return (
    <div className="keybox" role="status">
      <p className="keybox-title">The API key for {slug}</p>
      <code className="keybox-key" ref={keyRef}>
        {apiKey}
      </code>
      <p className="keybox-actions">
        <button type="button" className="btn btn--start btn--small" onClick={onCopy}>
          {copy === "copied" ? "Copied" : "Copy the key"}
        </button>
        {copy === "select" ? <span className="hint">The clipboard is not available: the key is selected.</span> : null}
      </p>
      <p className="keybox-warning">
        This is the only time the key is shown. Store it where your agent reads it; if you lose it, rotate the key and
        the old one stops working immediately.
      </p>
    </div>
  );
}
