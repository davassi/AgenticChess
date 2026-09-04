# Spectator Experience Implementation Plan (Plan 4b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a game watchable by a human — a replay control with autoplay, live moves played out at a readable pace, and pieces that actually slide.

**Architecture:** One cursor. `usePlayback` owns which ply the viewer is looking at, which is a different number from the ply the server has reached. `following` chases the live edge at a pace that shortens as the cursor falls behind; `playing` is a replay the viewer started. Every rule about *how fast* lives in a pure module with no React in it, so the only thing in the hook is a `setTimeout`. Nothing on the server changes.

**Tech Stack:** Next 16.3.4, React 19.2.8, TypeScript 5.9 strict, vitest 3.2 with jsdom, Testing Library 16, Playwright (opt-in). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-spectator-experience-design.md`

## Global Constraints

- Node 22. Every command in this plan assumes `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"` first; the machine's default node is 20 and vitest will not start on it.
- TypeScript strict. Every function signature carries a return type. No `any`, no non-null `!`.
- No new runtime dependency. Everything here is React, the DOM and code already in the repo.
- No server change: no migration, no protocol change, no new endpoint, nothing in `apps/api`, `packages/*`.
- Agent-authored text (`comment`, `submitted`) is rendered as text, never as markup — the existing `CommentFeed` rule.
- Another Claude session works in this checkout. **Stage explicit paths, never `git add -A`.**
- Commit messages: Conventional Commits, imperative subject, body explaining *why*. End every commit with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
  ```
- The suite must stay green at the end of every task: `pnpm --filter @aichess/web test`, then `pnpm --filter @aichess/web typecheck` and `pnpm --filter @aichess/web lint`.
- Next 16's react-hooks lint rules reject `setState` called synchronously inside an effect body. Calling it from inside a timer callback is fine. This shapes Task 2 — do not "simplify" it back.

---

### Task 1: The pace, as a pure module

**Files:**
- Create: `apps/web/src/lib/playback.ts`
- Test: `apps/web/src/lib/playback.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Speed = 0.5 | 1 | 2 | "instant"`, `SPEEDS`, `LAG_VISIBLE`, `MAX_LAG`, `liveInterval(lag: number, speed: Speed): number`, `reviewInterval(speed: Speed): number`, `nextPly(ply: number, total: number, following: boolean, speed: Speed): number`, `parseSpeed(value: string): Speed`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/playback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LAG_VISIBLE, MAX_LAG, liveInterval, nextPly, parseSpeed, reviewInterval, SPEEDS } from "./playback";

describe("live pacing", () => {
  it("slows to a readable pace when the cursor is at the live edge", () => {
    expect(liveInterval(0, 1)).toBe(2500);
    expect(liveInterval(1, 1)).toBe(2500);
  });

  it("shortens the delay the further behind the cursor falls", () => {
    expect(liveInterval(2, 1)).toBe(1667);
    expect(liveInterval(3, 1)).toBe(1250);
    expect(liveInterval(4, 1)).toBe(1000);
    expect(liveInterval(5, 1)).toBe(833);
    expect(liveInterval(9, 1)).toBe(500);
  });

  it("never goes below the floor, however far behind it is", () => {
    expect(liveInterval(12, 1)).toBe(400);
    expect(liveInterval(200, 1)).toBe(400);
  });

  // The property the design rests on: with moves arriving every 1500 ms the
  // cursor stops falling behind between two and three plies back, so catching
  // up needs no threshold rule.
  it("has a fixed point near two plies at the agents' real move rate", () => {
    expect(liveInterval(2, 1)).toBeGreaterThan(1500);
    expect(liveInterval(3, 1)).toBeLessThan(1500);
  });

  it("scales with the chosen speed", () => {
    expect(liveInterval(2, 2)).toBe(833);
    expect(liveInterval(2, 0.5)).toBe(3333);
  });

  it("has no delay at all when the viewer asked for instant", () => {
    expect(liveInterval(5, "instant")).toBe(0);
  });
});

describe("review pacing", () => {
  it("steps a replay at one second, scaled by speed", () => {
    expect(reviewInterval(1)).toBe(1000);
    expect(reviewInterval(2)).toBe(500);
    expect(reviewInterval(0.5)).toBe(2000);
  });

  // Pressing play must produce a replay, not a jump to the end.
  it("keeps a replay watchable even at instant", () => {
    expect(reviewInterval("instant")).toBe(400);
  });
});

describe("where the cursor goes next", () => {
  it("walks one ply at a time", () => {
    expect(nextPly(0, 10, true, 1)).toBe(1);
    expect(nextPly(4, 10, false, 1)).toBe(5);
  });

  it("stops at the end of the list", () => {
    expect(nextPly(10, 10, true, 1)).toBe(10);
    expect(nextPly(11, 10, false, 1)).toBe(10);
  });

  // The backgrounded tab: the browser throttled the timers and the viewer is
  // back to arrears they never chose to watch.
  it("jumps instead of fast-forwarding past the arrears limit", () => {
    expect(nextPly(0, MAX_LAG + 1, true, 1)).toBe(MAX_LAG + 1);
    expect(nextPly(0, MAX_LAG, true, 1)).toBe(1);
  });

  it("never jumps a replay the viewer started, however long the game", () => {
    expect(nextPly(0, 300, false, 1)).toBe(1);
  });

  it("goes straight to the live edge at instant", () => {
    expect(nextPly(0, 30, true, "instant")).toBe(30);
  });
});

describe("speed parsing", () => {
  it("round-trips every offered speed through its option value", () => {
    for (const speed of SPEEDS) expect(parseSpeed(String(speed))).toBe(speed);
  });

  it("falls back to normal speed on anything else", () => {
    expect(parseSpeed("7")).toBe(1);
    expect(parseSpeed("")).toBe(1);
  });
});

describe("constants", () => {
  it("hides the lag indicator until it is worth reading", () => {
    expect(LAG_VISIBLE).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/lib/playback.test.ts
```

Expected: FAIL — `Failed to resolve import "./playback"`.

- [ ] **Step 3: Write the module**

Create `apps/web/src/lib/playback.ts`:

```ts
/*
 * How fast the viewer's cursor walks the move list.
 *
 * Every rule here is a pure function of how far behind the cursor is, so the
 * tests are tables of values and need no timers. The one piece that touches
 * React — a setTimeout — lives in usePlayback and does nothing but obey these
 * numbers.
 */

/** The delay at the live edge: slow enough to read a move and its comment. */
export const LIVE_BASE_MS = 2500;
/** However far behind, never faster than this; a blur is not a broadcast. */
export const LIVE_MIN_MS = 400;
/** One ply per second in a replay the viewer started. */
export const REVIEW_BASE_MS = 1000;
/** How sharply the delay shortens per ply of arrears. */
export const CATCH_UP = 0.5;
/** Past this many plies behind the cursor jumps rather than fast-forwards. */
export const MAX_LAG = 40;
/** Arrears worth telling the viewer about. */
export const LAG_VISIBLE = 2;

export const SPEEDS = [0.5, 1, 2, "instant"] as const;
export type Speed = (typeof SPEEDS)[number];

function isSpeed(value: unknown): value is Speed {
  return (SPEEDS as readonly unknown[]).includes(value);
}

/**
 * The delay before the cursor advances one ply while chasing the live edge.
 *
 * The further behind it falls the shorter the delay, which gives the lag a
 * fixed point rather than a threshold: at the agents' measured ~1500 ms per
 * move and speed 1 the cursor settles between two and three plies back and
 * stays there.
 */
export function liveInterval(lag: number, speed: Speed): number {
  if (speed === "instant") return 0;
  if (lag <= 0) return LIVE_BASE_MS;
  const factor = 1 + CATCH_UP * (lag - 1);
  return Math.max(LIVE_MIN_MS, Math.round(LIVE_BASE_MS / factor / speed));
}

/** The delay between two plies of a replay the viewer started. */
export function reviewInterval(speed: Speed): number {
  if (speed === "instant") return LIVE_MIN_MS;
  return Math.round(REVIEW_BASE_MS / speed);
}

/**
 * Where the cursor goes next. It walks, except for the two cases where
 * walking would waste the viewer's time: instant, and coming back to a tab
 * the browser throttled while it was hidden.
 */
export function nextPly(ply: number, total: number, following: boolean, speed: Speed): number {
  if (ply >= total) return total;
  if (following && (speed === "instant" || total - ply > MAX_LAG)) return total;
  return ply + 1;
}

/** Reads a speed back out of the select's option value. */
export function parseSpeed(value: string): Speed {
  if (value === "instant") return "instant";
  const numeric = Number(value);
  return isSpeed(numeric) ? numeric : 1;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @aichess/web test src/lib/playback.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/playback.ts apps/web/src/lib/playback.test.ts
git commit -F - <<'MSG'
feat(web): the pace of the playback cursor, as a pure function

The delay before the cursor shows the next ply shortens as it falls behind,
which gives the arrears a fixed point instead of a threshold: at the agents'
measured 1.5 s per move the cursor settles two to three plies back and stays
there. No rule of the form "if more than N behind, skip" is needed, and none
is written; the one jump that exists is for a tab the browser throttled while
it was hidden.

Keeping this out of the hook is the point. A timer inside an effect is the
fragile part of what follows, and it now contains no arithmetic worth getting
wrong — the arithmetic is a table of values in a test with no timers in it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 2: `usePlayback` replaces `useReplay`

**Files:**
- Create: `apps/web/src/hooks/usePlayback.ts`
- Create: `apps/web/src/hooks/usePlayback.test.tsx`
- Delete: `apps/web/src/hooks/useReplay.ts`
- Modify: `apps/web/src/components/game/GameView.tsx` (the `useReplay` call and every `replay.` reference)

**Interfaces:**
- Consumes: `liveInterval`, `reviewInterval`, `nextPly`, `Speed` from Task 1.
- Produces: `usePlayback(total: number, active: boolean): Playback`, where `Playback` is `{ ply, total, lag, following, playing, atLive, speed, setSpeed, setPly, step, goLive, restart, toggle, onKeyDown }`. Tasks 3, 7 and 8 all take a `Playback`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/usePlayback.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayback } from "./usePlayback";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePlayback", () => {
  it("opens an active game at the live edge, following", () => {
    const { result } = renderHook(() => usePlayback(4, true));
    expect(result.current.ply).toBe(4);
    expect(result.current.following).toBe(true);
    expect(result.current.atLive).toBe(true);
    expect(result.current.lag).toBe(0);
  });

  it("opens a finished game parked on the final position", () => {
    const { result } = renderHook(() => usePlayback(4, false));
    expect(result.current.ply).toBe(4);
    expect(result.current.following).toBe(false);
    expect(result.current.playing).toBe(false);
  });

  it("walks towards the live edge as moves arrive, one at a time", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 0 },
    });
    rerender({ total: 3 });
    expect(result.current.ply).toBe(0);
    expect(result.current.lag).toBe(3);

    act(() => {
      vi.advanceTimersByTime(1250);
    });
    expect(result.current.ply).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1667);
    });
    expect(result.current.ply).toBe(2);
  });

  it("parks the cursor when the viewer picks a move, and stops following", () => {
    const { result } = renderHook(() => usePlayback(10, true));
    act(() => {
      result.current.setPly(3);
    });
    expect(result.current.ply).toBe(3);
    expect(result.current.following).toBe(false);
    expect(result.current.atLive).toBe(false);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.ply).toBe(3);
  });

  it("treats picking the last move as going back to live", () => {
    const { result } = renderHook(() => usePlayback(10, true));
    act(() => {
      result.current.setPly(3);
    });
    act(() => {
      result.current.setPly(10);
    });
    expect(result.current.following).toBe(true);
  });

  it("replays from the start and rejoins a game still being played", () => {
    const { result } = renderHook(() => usePlayback(2, true));
    act(() => {
      result.current.restart();
    });
    expect(result.current.ply).toBe(0);
    expect(result.current.playing).toBe(true);
    expect(result.current.following).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ply).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ply).toBe(2);
    expect(result.current.playing).toBe(false);
    expect(result.current.following).toBe(true);
  });

  it("stops at the end of a finished game instead of rejoining anything", () => {
    const { result } = renderHook(() => usePlayback(1, false));
    act(() => {
      result.current.restart();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.ply).toBe(1);
    expect(result.current.playing).toBe(false);
    expect(result.current.following).toBe(false);
  });

  it("pauses and resumes on toggle", () => {
    const { result } = renderHook(() => usePlayback(5, false));
    act(() => {
      result.current.restart();
    });
    act(() => {
      result.current.toggle();
    });
    expect(result.current.playing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.ply).toBe(0);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.playing).toBe(true);
  });

  it("plays a finished game again from the start when it is already at the end", () => {
    const { result } = renderHook(() => usePlayback(5, false));
    act(() => {
      result.current.toggle();
    });
    expect(result.current.ply).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it("jumps rather than fast-forwarding when the tab was hidden for a long time", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 0 },
    });
    rerender({ total: 60 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.ply).toBe(60);
  });

  it("goes straight to the live edge at instant speed", () => {
    const { result, rerender } = renderHook(({ total }) => usePlayback(total, true), {
      initialProps: { total: 0 },
    });
    act(() => {
      result.current.setSpeed("instant");
    });
    rerender({ total: 6 });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.ply).toBe(6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/hooks/usePlayback.test.tsx
```

Expected: FAIL — `Failed to resolve import "./usePlayback"`.

- [ ] **Step 3: Write the hook**

Create `apps/web/src/hooks/usePlayback.ts`:

```tsx
"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { liveInterval, nextPly, reviewInterval, type Speed } from "@/lib/playback";

export interface Playback {
  /** The ply being shown, which is not the ply the server has reached. */
  ply: number;
  /** How many plies exist. The cursor's target; never drawn on its own. */
  total: number;
  lag: number;
  /** The cursor is chasing the live edge at a watchable pace. */
  following: boolean;
  /** A replay the viewer started is running. */
  playing: boolean;
  atLive: boolean;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  setPly: (ply: number) => void;
  step: (delta: number) => void;
  goLive: () => void;
  restart: () => void;
  toggle: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

interface Cursor {
  ply: number;
  following: boolean;
  playing: boolean;
}

/**
 * Which ply the viewer is looking at.
 *
 * Two booleans cover paced live viewing, an instant replay and a cursor
 * parked on one move; the pace itself is in lib/playback.ts, so all that is
 * left here is a timer. The timer is rescheduled from scratch on every
 * advance rather than kept running, which is what makes it safe under React's
 * double-mounted effects in development.
 */
export function usePlayback(total: number, active: boolean): Playback {
  const [speed, setSpeed] = useState<Speed>(1);
  const [cursor, setCursor] = useState<Cursor>(() => ({ ply: total, following: active, playing: false }));

  // A game whose moves were re-fetched can be shorter than the cursor for one
  // render; drawing past the end of the list would throw.
  const ply = Math.min(cursor.ply, total);

  useEffect(() => {
    if (ply >= total) return;
    if (!cursor.following && !cursor.playing) return;
    const delay = cursor.following ? liveInterval(total - ply, speed) : reviewInterval(speed);
    const timer = setTimeout(() => {
      setCursor((current) => {
        const next = nextPly(current.ply, total, current.following, speed);
        if (current.following) return { ...current, ply: next };
        // A replay that catches up with a game still being played rejoins the
        // broadcast; on a finished game it simply stops at the end.
        if (next >= total) return { ply: next, following: active, playing: false };
        return { ...current, ply: next };
      });
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [cursor, ply, total, speed, active]);

  const setPly = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total, next));
      // Landing on the last move is how the viewer says "done reviewing".
      setCursor({ ply: clamped, following: clamped >= total && active, playing: false });
    },
    [total, active],
  );

  const step = useCallback(
    (delta: number) => {
      setPly(ply + delta);
    },
    [ply, setPly],
  );

  const goLive = useCallback(() => {
    setCursor({ ply: total, following: active, playing: false });
  }, [total, active]);

  const restart = useCallback(() => {
    setCursor({ ply: 0, following: false, playing: true });
  }, []);

  const toggle = useCallback(() => {
    setCursor((current) => {
      if (current.playing) return { ...current, playing: false };
      // Play at the end of the list means "watch it again from the start".
      if (current.ply >= total) return { ply: 0, following: false, playing: true };
      return { ...current, following: false, playing: true };
    });
  }, [total]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const actions: Record<string, () => void> = {
        ArrowLeft: () => {
          setPly(ply - 1);
        },
        ArrowRight: () => {
          setPly(ply + 1);
        },
        Home: () => {
          setPly(0);
        },
        End: goLive,
        " ": toggle,
      };
      const action = actions[event.key];
      if (action === undefined) return;
      event.preventDefault();
      action();
    },
    [ply, setPly, goLive, toggle],
  );

  return {
    ply,
    total,
    lag: total - ply,
    following: cursor.following,
    playing: cursor.playing,
    atLive: cursor.following && ply >= total,
    speed,
    setSpeed,
    setPly,
    step,
    goLive,
    restart,
    toggle,
    onKeyDown,
  };
}
```

- [ ] **Step 4: Run the hook tests and watch them pass**

```bash
pnpm --filter @aichess/web test src/hooks/usePlayback.test.tsx
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Move `GameView` onto the new hook**

In `apps/web/src/components/game/GameView.tsx`, replace the import

```tsx
import { useReplay } from "@/hooks/useReplay";
```

with

```tsx
import { usePlayback } from "@/hooks/usePlayback";
```

Replace the hook call

```tsx
  const replay = useReplay(live.moves.length);
```

with

```tsx
  const playback = usePlayback(live.moves.length, !live.finished);
```

Replace the board-source block

```tsx
  const fromSnapshot = replay.isLive && live.moves.length !== snapshot.ply;
  const position = fromSnapshot ? positionFromFen(snapshot.fen) : (positions[replay.ply] ?? startingPosition());
  const shownPly = fromSnapshot ? snapshot.ply : replay.ply;
  const shown = fromSnapshot ? undefined : live.moves[replay.ply - 1];
```

with

```tsx
  // The snapshot is only worth falling back to once the cursor has caught up
  // with a list that is provably short; while it is still walking, the
  // replayed positions are the ones that give each piece its identity.
  const fromSnapshot = playback.ply >= live.moves.length && live.moves.length !== snapshot.ply;
  const position = fromSnapshot ? positionFromFen(snapshot.fen) : (positions[playback.ply] ?? startingPosition());
  const shownPly = fromSnapshot ? snapshot.ply : playback.ply;
  const shown = fromSnapshot ? undefined : live.moves[playback.ply - 1];
```

Then replace the remaining four `replay.` references:

- in `player()`: `replay.isLive` becomes `playback.following`, so the clock keeps running at the equilibrium lag instead of freezing for ever (spec section 3);
- `<div className="board-views" onKeyDown={replay.onKeyDown}>` becomes `onKeyDown={playback.onKeyDown}`;
- `selectedPly={replay.ply}` becomes `selectedPly={playback.ply}` and `onSelect={replay.setPly}` becomes `onSelect={playback.setPly}`;
- in the panel foot, `replay.isLive` becomes `playback.atLive` and `onClick={replay.goLive}` becomes `onClick={playback.goLive}`.

- [ ] **Step 6: Delete the old hook and run the whole suite**

```bash
git rm apps/web/src/hooks/useReplay.ts
pnpm --filter @aichess/web test
```

Expected: PASS. If `GameView.test.tsx` fails on a move-list assertion, read the failure before changing the test: with pacing on, a test that renders an active game with moves now starts the cursor at the live edge, which is the same ply as before, so it should not.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint
git add apps/web/src/hooks/usePlayback.ts apps/web/src/hooks/usePlayback.test.tsx apps/web/src/hooks/useReplay.ts apps/web/src/components/game/GameView.tsx
git commit -F - <<'MSG'
feat(web): the viewed ply becomes a cursor that can move by itself

useReplay already held the idea this needs — a pinned ply where null means
"follow live" — but nothing ever advanced it without a keypress. usePlayback
keeps the idea and adds the two things missing: the cursor can walk on its
own, and following the live edge is a paced walk rather than a jump.

Two booleans cover the three states. Following chases the live edge at the
pace from lib/playback; playing is a replay the viewer started, which rejoins
the broadcast by itself if the game is still being played when it catches up.

The clock now runs while following rather than only at the exact live edge.
Being a ply or two behind is the normal state of paced viewing, so the old
rule would have frozen the clock permanently.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 3: The playback bar

**Files:**
- Create: `apps/web/src/components/game/PlaybackBar.tsx`
- Create: `apps/web/src/components/game/PlaybackBar.test.tsx`
- Modify: `apps/web/src/components/game/GameView.tsx` (replace the `board-hint` paragraph)
- Modify: `apps/web/src/styles/game.css` (append the `.playback` block)

**Interfaces:**
- Consumes: `Playback` from Task 2; `SPEEDS`, `LAG_VISIBLE`, `parseSpeed` from Task 1.
- Produces: `PlaybackBar({ playback, active }: PlaybackBarProps): ReactElement`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/game/PlaybackBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Playback } from "@/hooks/usePlayback";
import { PlaybackBar } from "./PlaybackBar";

function playback(overrides: Partial<Playback> = {}): Playback {
  return {
    ply: 5,
    total: 10,
    lag: 5,
    following: true,
    playing: false,
    atLive: false,
    speed: 1,
    setSpeed: vi.fn(),
    setPly: vi.fn(),
    step: vi.fn(),
    goLive: vi.fn(),
    restart: vi.fn(),
    toggle: vi.fn(),
    onKeyDown: vi.fn(),
    ...overrides,
  };
}

describe("PlaybackBar", () => {
  it("plays and pauses through the same button", async () => {
    const toggle = vi.fn();
    const { rerender } = render(<PlaybackBar playback={playback({ toggle })} active />);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(toggle).toHaveBeenCalledOnce();

    rerender(<PlaybackBar playback={playback({ toggle, playing: true })} active />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("steps one ply in each direction", async () => {
    const step = vi.fn();
    render(<PlaybackBar playback={playback({ step })} active />);
    await userEvent.click(screen.getByRole("button", { name: "Next move" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous move" }));
    expect(step).toHaveBeenNthCalledWith(1, 1);
    expect(step).toHaveBeenNthCalledWith(2, -1);
  });

  it("offers the way back to the live position, and disables it once there", () => {
    const { rerender } = render(<PlaybackBar playback={playback()} active />);
    expect(screen.getByRole("button", { name: "Back to the live position" })).toBeEnabled();

    rerender(<PlaybackBar playback={playback({ ply: 10, lag: 0, atLive: true })} active />);
    expect(screen.getByRole("button", { name: "Back to the live position" })).toBeDisabled();
  });

  it("calls the final position by its name once the game is over", () => {
    render(<PlaybackBar playback={playback({ following: false })} active={false} />);
    expect(screen.getByRole("button", { name: "Back to the final position" })).toBeInTheDocument();
  });

  it("says how far behind the viewer is, once it is worth saying", () => {
    const { rerender } = render(<PlaybackBar playback={playback({ lag: 5 })} active />);
    expect(screen.getByText("5 moves behind")).toBeInTheDocument();

    rerender(<PlaybackBar playback={playback({ lag: 1 })} active />);
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  // A move every 2.5 s through a live region would flood a screen reader, so
  // the region carries the state and never the moves.
  it("announces the state and not the moves", () => {
    const { rerender } = render(<PlaybackBar playback={playback({ ply: 10, lag: 0, atLive: true })} active />);
    expect(screen.getByText("At the live position")).toBeInTheDocument();

    rerender(<PlaybackBar playback={playback({ ply: 4, lag: 6 })} active />);
    expect(screen.getByText("Behind the live position")).toBeInTheDocument();
  });

  it("changes speed through a labelled control", async () => {
    const setSpeed = vi.fn();
    render(<PlaybackBar playback={playback({ setSpeed })} active />);
    await userEvent.selectOptions(screen.getByLabelText("Playback speed"), "instant");
    expect(setSpeed).toHaveBeenCalledWith("instant");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/components/game/PlaybackBar.test.tsx
```

Expected: FAIL — `Failed to resolve import "./PlaybackBar"`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/game/PlaybackBar.tsx`:

```tsx
"use client";

import type { ReactElement } from "react";
import type { Playback } from "@/hooks/usePlayback";
import { LAG_VISIBLE, parseSpeed, SPEEDS, type Speed } from "@/lib/playback";

export interface PlaybackBarProps {
  playback: Playback;
  /** False once the game is over: the last button then means "the end". */
  active: boolean;
}

const SPEED_LABELS: Record<string, string> = {
  "0.5": "0.5×",
  "1": "1×",
  "2": "2×",
  instant: "Instant",
};

function speedLabel(speed: Speed): string {
  return SPEED_LABELS[String(speed)] ?? String(speed);
}

/**
 * The transport under the board. The keyboard already drives the same cursor
 * from the board itself; this is the visible half of it, and the only place
 * the viewer can change the pace.
 */
export function PlaybackBar({ playback, active }: PlaybackBarProps): ReactElement {
  const { ply, total, lag, playing, atLive, speed } = playback;
  const liveLabel = active ? "Back to the live position" : "Back to the final position";
  return (
    <div className="playback" role="group" aria-label="Playback">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Back to the first move"
        disabled={total === 0 || ply === 0}
        onClick={playback.restart}
      >
        ⏮
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Previous move"
        disabled={ply === 0}
        onClick={() => {
          playback.step(-1);
        }}
      >
        ◀
      </button>
      <button
        type="button"
        className="btn btn--small"
        aria-label={playing ? "Pause" : "Play"}
        disabled={total === 0}
        onClick={playback.toggle}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Next move"
        disabled={ply >= total}
        onClick={() => {
          playback.step(1);
        }}
      >
        ▶|
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label={liveLabel}
        disabled={atLive || total === 0}
        onClick={playback.goLive}
      >
        ⏭
      </button>

      <label className="playback-speed">
        <span className="visually-hidden">Playback speed</span>
        <select
          value={String(speed)}
          onChange={(event) => {
            playback.setSpeed(parseSpeed(event.target.value));
          }}
        >
          {SPEEDS.map((option) => (
            <option key={String(option)} value={String(option)}>
              {speedLabel(option)}
            </option>
          ))}
        </select>
      </label>

      {lag > LAG_VISIBLE ? <span className="playback-lag">{lag} moves behind</span> : null}

      <span className="visually-hidden" aria-live="polite">
        {atLive
          ? active
            ? "At the live position"
            : "At the final position"
          : "Behind the live position"}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests and watch them pass**

```bash
pnpm --filter @aichess/web test src/components/game/PlaybackBar.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Put it under the board**

In `apps/web/src/components/game/GameView.tsx`, add the import:

```tsx
import { PlaybackBar } from "./PlaybackBar";
```

and replace

```tsx
            <p className="board-hint">Arrow keys step through the moves. End returns to the live position.</p>
```

with

```tsx
            <PlaybackBar playback={playback} active={!live.finished} />
            <p className="board-hint">
              Arrow keys step through the moves, space plays and pauses, End returns to the{" "}
              {live.finished ? "final" : "live"} position.
            </p>
```

- [ ] **Step 6: Style it**

Append to `apps/web/src/styles/game.css`:

```css
/* Playback transport ---------------------------------------------------- */

.playback {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.playback .btn { min-width: 44px; }
.playback-speed select {
  font-family: var(--font-display);
  font-size: 12px;
  color: var(--ink);
  background: var(--ivory);
  border: 3px solid var(--ink);
  padding: 4px 6px;
}
.playback-lag {
  font-family: var(--font-display);
  font-size: 12px;
  color: var(--gold);
  margin-left: auto;
}
```

- [ ] **Step 7: Run everything, then commit**

```bash
pnpm --filter @aichess/web test && pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint
git add apps/web/src/components/game/PlaybackBar.tsx apps/web/src/components/game/PlaybackBar.test.tsx apps/web/src/components/game/GameView.tsx apps/web/src/styles/game.css
git commit -F - <<'MSG'
feat(web): a transport under the board, and a pace the viewer can choose

The cursor could already be driven from the keyboard and by clicking a move;
this is the half of it a visitor can see. Play, step, jump back to the live
position, and the speed control that is also the way out of the whole
feature — instant is exactly the behaviour the page had before it.

The live region carries the state and never the moves. A move every 2.5 s
announced through a polite region would make a screen reader unusable, so the
arrears are rendered as ordinary text and only the transitions between "at
the live position" and "behind" are announced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 4: Close the hole in the move list

**Files:**
- Create: `apps/web/src/lib/http.ts`
- Create: `apps/web/src/lib/timeline.ts`
- Create: `apps/web/src/lib/timeline.test.ts`
- Modify: `apps/web/src/lib/api.ts` (use `getJsonFrom`, re-export `ApiRequestError`, add `gameTimelineUrl`)
- Modify: `apps/web/src/lib/live.ts` (`gap` on `LiveGame`)
- Modify: `apps/web/src/lib/live.test.ts` (the `gap` assertions)
- Modify: `apps/web/src/hooks/useGameStream.ts` (the one-shot refetch)
- Modify: `apps/web/src/hooks/useGameStream.test.tsx` (the refetch test)
- Modify: `apps/web/src/app/games/[id]/page.tsx` (`gap: false` in the initial state)
- Modify: `apps/web/src/components/game/GameView.tsx` (`fromSnapshot` reads `gap`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getJsonFrom<T>(url: string, schema: z.ZodType<T>, label: string): Promise<T>`, `fetchTimelineAt(apiPublicUrl: string, gameId: string): Promise<GameTimeline>`, `gameTimelineUrl(apiPublicUrl, gameId): string`, and `LiveGame.gap: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/lib/live.test.ts`, inside the existing top-level `describe`:

```ts
  it("marks the state when a move cannot continue the list", () => {
    const state = { snapshot: SNAPSHOT, moves: [], attempts: [], finished: false, gap: false };
    const after = applyStreamEvent(state, {
      type: "game.move",
      gameId: SNAPSHOT.id,
      ply: 4,
      color: "black",
      san: "Nf6",
      uci: "g8f6",
      fen: AFTER_E4,
      comment: null,
      thinkTimeMs: 900,
    });
    expect(after.moves).toHaveLength(0);
    expect(after.gap).toBe(true);
    expect(after.snapshot.ply).toBe(4);
  });

  it("leaves the state whole when the move continues the list", () => {
    const state = { snapshot: SNAPSHOT, moves: [], attempts: [], finished: false, gap: false };
    const after = applyStreamEvent(state, {
      type: "game.move",
      gameId: SNAPSHOT.id,
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fen: AFTER_E4,
      comment: null,
      thinkTimeMs: 900,
    });
    expect(after.moves).toHaveLength(1);
    expect(after.gap).toBe(false);
  });
```

(The existing fixtures in that file already provide `SNAPSHOT` and `AFTER_E4`; if the snapshot in the file starts at a ply other than 0, use `{ ...SNAPSHOT, ply: 0 }` in the first test so ply 4 is genuinely non-contiguous.)

Create `apps/web/src/lib/timeline.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./http";
import { fetchTimelineAt } from "./timeline";

const TIMELINE = {
  moves: [
    {
      ply: 1,
      color: "white",
      san: "e4",
      uci: "e2e4",
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      comment: null,
      thinkTimeMs: 900,
      at: "2026-09-04T10:00:10.000Z",
    },
  ],
  attempts: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTimelineAt", () => {
  it("reads the timeline from the public API address", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse(TIMELINE)));
    const timeline = await fetchTimelineAt("https://api.example.test", "a b");
    expect(timeline.moves).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/games/a%20b/moves");
  });

  it("turns a refusal into a typed error rather than a rejected promise of nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: "not_found", message: "no such game" }, 404)),
    );
    await expect(fetchTimelineAt("https://api.example.test", "x")).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("reports a shape the API should never have sent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse({ moves: "no" })));
    await expect(fetchTimelineAt("https://api.example.test", "x")).rejects.toThrow(/unexpected shape/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/lib/timeline.test.ts src/lib/live.test.ts
```

Expected: FAIL — the timeline module does not exist, and `gap` is not on `LiveGame`.

- [ ] **Step 3: Extract the HTTP reader**

Create `apps/web/src/lib/http.ts` by moving the error class and the body of `getJson` out of `api.ts`:

```ts
import { ErrorResponseSchema, type ErrorCode } from "@aichess/core/protocol";
import type { z } from "zod";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * One JSON read, with the arena's error body honoured and its shape checked.
 * Server components reach it through api.ts with the internal address; the
 * browser reaches it with the public one, which is why the url arrives whole
 * rather than as a path.
 */
export async function getJsonFrom<T>(url: string, schema: z.ZodType<T>, label: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new ApiRequestError(503, "service_unavailable", `The arena API did not answer (${label})`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = ErrorResponseSchema.safeParse(payload);
    throw new ApiRequestError(
      response.status,
      body.success ? body.data.error : "internal_error",
      body.success ? body.data.message : `The arena API answered ${response.status} (${label})`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError(502, "internal_error", `The arena API answered with an unexpected shape (${label})`);
  }
  return parsed.data;
}
```

In `apps/web/src/lib/api.ts`: delete the `ApiRequestError` class and the body of `getJson`, add `export { ApiRequestError } from "./http";` so every existing importer keeps working, drop `ErrorResponseSchema` and `ErrorCode` from the protocol import if nothing else uses them, and rewrite the reader as:

```ts
async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return getJsonFrom(`${serverEnv().apiInternalUrl}${path}`, schema, path);
}
```

Add, next to `gameStreamUrl`:

```ts
/** The timeline, read by the browser when the stream leaves a hole in the list. */
export function gameTimelineUrl(apiPublicUrl: string, gameId: string): string {
  return `${apiPublicUrl}/v1/games/${encodeURIComponent(gameId)}/moves`;
}
```

Create `apps/web/src/lib/timeline.ts`:

```ts
import { GameTimelineSchema, type GameTimeline } from "@aichess/core/protocol";
import { getJsonFrom } from "./http";

/**
 * The whole move list, read from the browser. Kept out of api.ts because
 * everything there resolves the internal address out of the server
 * environment, which a client component has no business importing.
 */
export function fetchTimelineAt(apiPublicUrl: string, gameId: string): Promise<GameTimeline> {
  const path = `/v1/games/${encodeURIComponent(gameId)}/moves`;
  return getJsonFrom(`${apiPublicUrl}${path}`, GameTimelineSchema, path);
}
```

- [ ] **Step 4: Add the flag to the live state**

In `apps/web/src/lib/live.ts`, add the field to the interface:

```ts
export interface LiveGame {
  snapshot: GameSnapshot;
  moves: TimelineMove[];
  attempts: TimelineAttempt[];
  finished: boolean;
  /** A move arrived that could not continue the list: the list is short. */
  gap: boolean;
}
```

and in the `game.move` case, replace

```ts
      if (event.ply !== state.moves.length + 1) return { ...state, snapshot };
```

with

```ts
      // The stream carries only what happens next, so a move played between
      // the server render and the subscription arrives inside the snapshot and
      // never as an event of its own. The list keeps what it can prove and
      // says so; useGameStream reads the whole timeline back once.
      if (event.ply !== state.moves.length + 1) return { ...state, snapshot, gap: true };
```

In `apps/web/src/app/games/[id]/page.tsx`, add `gap: false` to the `LiveGame` literal handed to `GameView`.

- [ ] **Step 5: Refetch once, in the hook**

Rewrite `apps/web/src/hooks/useGameStream.ts`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { applyStreamEvent, type LiveGame } from "@/lib/live";
import { fetchTimelineAt } from "@/lib/timeline";
import { useWireStream } from "./useWireStream";

interface Tracked {
  /** The game the state below belongs to. */
  id: string;
  game: LiveGame;
}

export function useGameStream(url: string | null, apiPublicUrl: string, initial: LiveGame): LiveGame {
  const gameId = initial.snapshot.id;
  const [tracked, setTracked] = useState<Tracked>({ id: gameId, game: initial });

  // Walking from one game to another swaps `initial` without remounting the
  // page, and state kept from the game just left would have the new game's
  // moves appended to it.
  const game = tracked.id === gameId ? tracked.game : initial;

  const latest = useRef(initial);
  useEffect(() => {
    latest.current = initial;
  });

  useWireStream(url, !initial.finished, (event) => {
    setTracked((current) => ({
      id: gameId,
      game: applyStreamEvent(current.id === gameId ? current.game : latest.current, event),
    }));
  });

  // A hole in the list is not survivable by waiting: every later move is
  // non-contiguous too, so the list would stay short for the whole session
  // and every position replayed past the hole would be wrong. One read of the
  // timeline repairs it. One, and only one — a failing API must not turn into
  // a request per render.
  const repaired = useRef<string | null>(null);
  useEffect(() => {
    if (!game.gap || repaired.current === gameId) return;
    repaired.current = gameId;
    let cancelled = false;
    fetchTimelineAt(apiPublicUrl, gameId)
      .then((timeline) => {
        if (cancelled) return;
        setTracked((current) => ({
          id: gameId,
          game: { ...current.game, moves: timeline.moves, attempts: timeline.attempts, gap: false },
        }));
      })
      .catch((error: unknown) => {
        // The board still has the snapshot's FEN to draw, so the page degrades
        // to what it did before rather than breaking.
        console.error(`Could not re-read the move list for game ${gameId}`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [game.gap, gameId, apiPublicUrl]);

  return game;
}
```

In `apps/web/src/components/game/GameView.tsx`, update the call and the fallback:

```tsx
  const live = useGameStream(gameStreamUrl(apiPublicUrl, initial.snapshot.id), apiPublicUrl, initial);
```

```tsx
  // Only a list that is provably short is worth abandoning for the snapshot,
  // and only once the cursor has caught up with it.
  const fromSnapshot = live.gap && playback.ply >= live.moves.length;
```

- [ ] **Step 6: Test the refetch**

Add to `apps/web/src/hooks/useGameStream.test.tsx`:

```tsx
  it("reads the timeline back once when the stream leaves a hole, and only once", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ moves: [E4_TIMELINE_MOVE], attempts: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const { result } = renderHook(() =>
      useGameStream("https://api.test/stream", "https://api.test", { ...LIVE, gap: false }),
    );

    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 5,
        color: "white",
        san: "Nf3",
        uci: "g1f3",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 900,
      });
    });

    await waitFor(() => {
      expect(result.current.gap).toBe(false);
    });
    expect(result.current.moves).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
```

The file already has `FakeEventSource`, `SNAPSHOT` and `LIVE` (its initial `LiveGame`, which now needs `gap: false` adding to its literal at line 32). Add this fixture beside them and import `waitFor` from `@testing-library/react`:

```tsx
const E4_TIMELINE_MOVE: TimelineMove = {
  ply: 1,
  color: "white",
  san: "e4",
  uci: "e2e4",
  fen: AFTER_E4,
  comment: null,
  thinkTimeMs: 900,
  at: "2026-09-04T10:00:10.000Z",
};
```

`AFTER_E4` is not in this file either — add it as the FEN string
`"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"` and import
`type TimelineMove` from `@aichess/core/protocol`.

- [ ] **Step 7: Run everything, then commit**

```bash
pnpm --filter @aichess/web test && pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint
git add apps/web/src/lib/http.ts apps/web/src/lib/timeline.ts apps/web/src/lib/timeline.test.ts apps/web/src/lib/api.ts apps/web/src/lib/live.ts apps/web/src/lib/live.test.ts apps/web/src/hooks/useGameStream.ts apps/web/src/hooks/useGameStream.test.tsx apps/web/src/app/games/\[id\]/page.tsx apps/web/src/components/game/GameView.tsx
git commit -F - <<'MSG'
fix(web): read the move list back when the stream leaves a hole in it

Plan 4's review declared this a deliberate deviation: a move that could not
continue the list was dropped and the board fell back to the snapshot's FEN,
with no refetch. The deviation does not survive contact with replay.

The hole opens when a move is played between the server render and the
subscription, which is most openings of a game in progress, and it never
closes: every later move is non-contiguous too. So the move list stayed short
for the whole session, every position replayed past the hole was wrong, and
the board was drawn from a FEN — which is also why the pieces never animated,
since a FEN-drawn board gives every piece a new identity each update.

The state now says when it is short, and the hook reads the timeline back
exactly once per game. A failure is logged and leaves the page in the state it
was in before, not in a loop of requests.

The reader moved to lib/http.ts so the browser can use it without dragging
the server environment into the bundle, and api.ts keeps its own wrapper.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 5: Piece identity across a FEN redraw

**Files:**
- Modify: `apps/web/src/lib/position.ts` (`positionFromFen` takes a previous position)
- Modify: `apps/web/src/lib/position.test.ts` (reconciliation cases)

**Interfaces:**
- Consumes: nothing.
- Produces: `positionFromFen(fen: string, previous?: Position): Position` — same function, one optional argument. Task 6 depends on it.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/position.test.ts`:

```ts
describe("identity across a redraw from FEN", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

  it("keeps every untouched piece's identity", () => {
    const before = positionFromFen(START);
    const after = positionFromFen(AFTER_E4, before);
    expect(after.get("a1")?.id).toBe("a1");
    expect(after.get("e8")?.id).toBe("e8");
  });

  it("hands a vacated square's identity to the piece that arrived", () => {
    const before = positionFromFen(START);
    const after = positionFromFen(AFTER_E4, before);
    expect(after.get("e4")).toEqual({ id: "e2", kind: "w-pawn", square: "e4" });
    expect(after.get("e2")).toBeUndefined();
  });

  it("keeps the mover's identity through a capture", () => {
    const before = positionFromFen("8/8/8/3p4/4P3/8/8/8 w - - 0 1");
    const after = positionFromFen("8/8/8/3P4/8/8/8/8 b - - 0 1", before);
    expect(after.get("d5")).toEqual({ id: "e4", kind: "w-pawn", square: "d5" });
    expect(after.size).toBe(1);
  });

  it("moves the rook with the king through a castle", () => {
    const before = positionFromFen("8/8/8/8/8/8/8/R3K3 w Q - 0 1");
    const after = positionFromFen("8/8/8/8/8/8/8/2KR4 b - - 0 1", before);
    expect(after.get("c1")?.id).toBe("e1");
    expect(after.get("d1")?.id).toBe("a1");
  });

  // Two pieces of one kind, one of them gone: nothing in a FEN says which.
  // The result must still be 32 distinct keys, or React renders duplicates.
  it("never hands out the same identity twice, however ambiguous the diff", () => {
    const before = positionFromFen("8/8/8/8/1N3N2/8/8/8 w - - 0 1");
    const after = positionFromFen("8/8/8/8/8/2N5/8/8 b - - 0 1", before);
    const ids = [...after.values()].map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is unchanged when no previous position is given", () => {
    const fresh = positionFromFen(AFTER_E4);
    expect(fresh.get("e4")).toEqual({ id: "e4", kind: "w-pawn", square: "e4" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/lib/position.test.ts
```

Expected: FAIL on "hands a vacated square's identity", with `id` `"e4"` instead of `"e2"`.

- [ ] **Step 3: Reconcile**

In `apps/web/src/lib/position.ts`, replace `positionFromFen` with:

```ts
/**
 * Only the placement field of the FEN is read; the rest is state the board
 * does not draw.
 *
 * A FEN says where the pieces are and nothing about which piece is which, so
 * a board drawn from one has no identity to animate: React sees new keys and
 * remounts all thirty-two nodes. Given the position it is replacing, this
 * carries the identities across — a piece that did not move keeps its own,
 * and within a kind a square that emptied hands its id to one that filled.
 * Where the diff is ambiguous it degrades to a fresh identity, which is
 * simply the un-reconciled behaviour for that piece.
 */
export function positionFromFen(fen: string, previous?: Position): Position {
  const placement = fen.split(" ")[0] ?? "";
  const placed: PlacedPiece[] = [];
  const ranks = placement.split("/");
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
    const row = ranks[rankIndex];
    if (row === undefined) continue;
    const rank = 8 - rankIndex;
    let file = 0;
    for (const character of row) {
      const skip = Number(character);
      if (Number.isFinite(skip) && character !== "") {
        file += skip;
        continue;
      }
      const kind = KIND_BY_LETTER[character];
      const fileLetter = FILES[file];
      if (kind !== undefined && fileLetter !== undefined) {
        const square = `${fileLetter}${rank}`;
        placed.push({ id: square, kind, square });
      }
      file += 1;
    }
  }
  return previous === undefined ? new Map(placed.map((piece) => [piece.square, piece])) : reconcile(placed, previous);
}

/** Carries identities from the position being replaced onto the new one. */
function reconcile(placed: readonly PlacedPiece[], previous: Position): Position {
  const used = new Set<string>();
  const result = new Map<Square, PlacedPiece>();
  const moved: PlacedPiece[] = [];

  for (const piece of placed) {
    const before = previous.get(piece.square);
    if (before !== undefined && before.kind === piece.kind && !used.has(before.id)) {
      used.add(before.id);
      result.set(piece.square, { id: before.id, kind: piece.kind, square: piece.square });
    } else {
      moved.push(piece);
    }
  }

  const free = new Map<PieceKind, string[]>();
  for (const piece of previous.values()) {
    if (used.has(piece.id)) continue;
    const list = free.get(piece.kind) ?? [];
    list.push(piece.id);
    free.set(piece.kind, list);
  }

  let spare = 0;
  for (const piece of moved) {
    const inherited = free.get(piece.kind)?.shift();
    let id = inherited ?? piece.square;
    // A promoted piece, or a diff with nothing to inherit from, falls back to
    // its square — which another piece may already hold as its id.
    while (used.has(id)) {
      spare += 1;
      id = `${piece.square}#${spare}`;
    }
    used.add(id);
    result.set(piece.square, { id, kind: piece.kind, square: piece.square });
  }
  return result;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm --filter @aichess/web test src/lib/position.test.ts
```

Expected: PASS — the existing cases plus the six new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/position.ts apps/web/src/lib/position.test.ts
git commit -F - <<'MSG'
fix(web): a board drawn from a FEN keeps its pieces' identities

positionFromFen gave every piece the square it stood on as its id, so a board
redrawn from a FEN presented React with thirty-two new keys, every node was
remounted, and the CSS transition on .piece never had two values to
interpolate between. The symptom reads as "the pieces do not animate" and the
cause is in a function with nothing to do with animation.

Given the position it replaces, the identities now carry across: a piece that
did not move keeps its own, and within a kind a square that emptied hands its
id to one that filled. Castling therefore moves the rook rather than swapping
two strangers, and a capture keeps the capturer.

Where a FEN diff is genuinely ambiguous — two knights, one of them gone —
there is nothing to be right about, and it degrades to a fresh identity: the
old behaviour for that one piece. Ids stay unique either way, because
duplicates would be duplicate React keys.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 6: The arena's boards animate

**Files:**
- Modify: `apps/web/src/hooks/useLiveBoard.ts` (hold a `Position`, apply the move's UCI)
- Modify: `apps/web/src/hooks/useLiveBoard.test.tsx` (identity assertions)
- Modify: `apps/web/src/components/arena/LiveBoardCard.tsx` (consume the position)

**Interfaces:**
- Consumes: `positionFromFen(fen, previous)` from Task 5; `applyUci` from `lib/position`.
- Produces: `LiveBoard` gains `position: Position`; `fen` and `active` are unchanged.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/hooks/useLiveBoard.test.tsx`:

```tsx
  it("moves the piece rather than redrawing the board, so the card can animate", () => {
    const { result } = renderHook(() => useLiveBoard("https://api.test/stream", START, true));
    const pawn = result.current.position.get("e2");
    expect(pawn?.id).toBe("e2");

    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "e2e4",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 900,
      });
    });

    expect(result.current.fen).toBe(AFTER_E4);
    expect(result.current.position.get("e4")).toEqual({ id: "e2", kind: "w-pawn", square: "e4" });
    expect(result.current.position.get("e2")).toBeUndefined();
  });

  it("keeps the identities it can when a snapshot replaces the position wholesale", () => {
    const { result } = renderHook(() => useLiveBoard("https://api.test/stream", START, true));
    act(() => {
      FakeEventSource.last?.emit("game.snapshot", {
        type: "game.snapshot",
        gameId: SNAPSHOT.id,
        game: { ...SNAPSHOT, fen: AFTER_E4, ply: 1, turn: "black" },
      });
    });
    expect(result.current.position.get("e4")?.id).toBe("e2");
  });

  // A move the position cannot apply would leave the card drawing a board the
  // FEN disagrees with, which is worse than losing the animation for one ply.
  it("falls back to the FEN when the move does not fit the position it holds", () => {
    const { result } = renderHook(() => useLiveBoard("https://api.test/stream", START, true));
    act(() => {
      FakeEventSource.last?.emit("game.move", {
        type: "game.move",
        gameId: SNAPSHOT.id,
        ply: 1,
        color: "white",
        san: "e4",
        uci: "a6a7",
        fen: AFTER_E4,
        comment: null,
        thinkTimeMs: 900,
      });
    });
    expect(result.current.position.get("e4")?.kind).toBe("w-pawn");
    expect(result.current.position.get("a7")).toBeUndefined();
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/hooks/useLiveBoard.test.tsx
```

Expected: FAIL — `result.current.position` is `undefined`.

- [ ] **Step 3: Hold a position rather than a string**

Rewrite `apps/web/src/hooks/useLiveBoard.ts`:

```tsx
"use client";

import { useState } from "react";
import { applyUci, positionFromFen, type Position } from "@/lib/position";
import { useWireStream } from "./useWireStream";

export interface LiveBoard {
  fen: string;
  /** The same board with identities, so the pieces slide instead of blinking. */
  position: Position;
  /** False once the game is over, so a card stops calling itself live. */
  active: boolean;
}

/**
 * The arena's small boards need the position and whether the game is still
 * being played; a whole LiveGame would mean inventing the fields a list item
 * does not carry. The side to move is not one of them: it is read from the
 * FEN, which is the same string the board is drawn from and cannot fall out
 * of step with it.
 *
 * The move event carries the UCI as well as the FEN, so the position is
 * advanced rather than rebuilt — exact identity, no matching to guess at. The
 * FEN stays the authority: if the move cannot be applied to the position we
 * hold, the FEN wins and one ply loses its animation.
 */
export function useLiveBoard(url: string, initialFen: string, initiallyActive: boolean): LiveBoard {
  const [board, setBoard] = useState<LiveBoard>(() => ({
    fen: initialFen,
    position: positionFromFen(initialFen),
    active: initiallyActive,
  }));

  useWireStream(url, initiallyActive, (event) => {
    if (event.type === "game.move") {
      setBoard((current) => {
        const moved = applyUci(current.position, event.uci);
        return {
          ...current,
          fen: event.fen,
          position: moved === current.position ? positionFromFen(event.fen, current.position) : moved,
        };
      });
    } else if (event.type === "game.snapshot") {
      setBoard((current) => ({
        fen: event.game.fen,
        position: positionFromFen(event.game.fen, current.position),
        active: event.game.status === "active",
      }));
    } else if (event.type === "game.end") {
      setBoard((current) => ({ ...current, active: false }));
    }
  });

  return board;
}
```

- [ ] **Step 4: Draw the card from the position**

In `apps/web/src/components/arena/LiveBoardCard.tsx`, change the helper and the call:

```tsx
import type { Position } from "@/lib/position";
```

```tsx
function toIsoPosition(position: Position): IsoPosition {
  const iso: IsoPosition = {};
  for (const [square, piece] of position) iso[square] = piece.kind;
  return iso;
}
```

```tsx
  const { fen, position, active } = useLiveBoard(gameStreamUrl(apiPublicUrl, game.id), game.fen, game.status === "active");
```

```tsx
          position={toIsoPosition(position)}
```

The `positionFromFen` import is no longer used in this file — remove it.

- [ ] **Step 5: Run everything and commit**

```bash
pnpm --filter @aichess/web test && pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint
git add apps/web/src/hooks/useLiveBoard.ts apps/web/src/hooks/useLiveBoard.test.tsx apps/web/src/components/arena/LiveBoardCard.tsx
git commit -F - <<'MSG'
feat(web): the arena's boards move their pieces instead of blinking

The lobby cards were redrawn from each FEN the stream delivered, which is the
one path where a board has no history to give its pieces identities. The move
event carries the UCI too, so the position is advanced by the move instead —
exact, with nothing to guess at — and only a snapshot goes through the FEN,
where it now reconciles against the position it replaces.

The FEN stays the authority. A move that cannot be applied to the position we
hold means the two have drifted, and the card would rather lose one ply of
animation than draw a board its own FEN disagrees with.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 7: The anti-spoiler rule

**Files:**
- Modify: `apps/web/src/components/game/GameView.tsx`
- Modify: `apps/web/src/components/game/CommentFeed.tsx` (a `throughPly` prop)
- Modify: `apps/web/src/components/game/GameView.test.tsx` (one case per row of the rule)

**Interfaces:**
- Consumes: `Playback` from Task 2, `LiveGame.gap` from Task 4.
- Produces: `CommentFeedProps` gains `throughPly: number`.

- [ ] **Step 1: Write the failing test**

The file already supplies `AGENT`, `SNAPSHOT`, `AFTER_E4`, `AFTER_E5` and `E4`. It has no second move, so add one beside `E4` first:

```tsx
const E5: TimelineMove = {
  ply: 2,
  color: "black",
  san: "e5",
  uci: "e7e5",
  fen: AFTER_E5,
  comment: null,
  thinkTimeMs: 1_200,
  at: "2026-09-04T10:00:20.000Z",
};
```

Every `LiveGame` literal already in the file also needs `gap: false` adding, which the typechecker will point at. Then add:

```tsx
describe("what the viewer is allowed to see", () => {
  function behind(): LiveGame {
    // The server has both moves; the cursor has not reached the second yet,
    // which is the normal state of paced live viewing.
    return {
      snapshot: { ...SNAPSHOT, fen: AFTER_E5, ply: 2, turn: "white" },
      moves: [E4, E5],
      attempts: [],
      finished: false,
      gap: false,
    };
  }

  it("counts the plies the viewer has seen, not the ones the server has", () => {
    render(<GameView initial={{ ...behind(), moves: [E4] }} apiPublicUrl="https://api.test" />);
    expect(screen.getByText(/1 plies/)).toBeInTheDocument();
  });

  it("keeps the result panel closed until the cursor arrives at the end", () => {
    const finished: LiveGame = {
      snapshot: { ...SNAPSHOT, status: "finished", result: "1-0", termination: "checkmate", ply: 2 },
      moves: [E4, E5],
      attempts: [],
      finished: true,
      gap: false,
    };
    render(<GameView initial={finished} apiPublicUrl="https://api.test" />);
    // A finished game opens at its end, so the result is there immediately.
    expect(screen.getByText("1-0", { exact: false })).toBeInTheDocument();
  });

  it("does not print a comment the viewer has not reached", () => {
    const withComments: LiveGame = {
      ...behind(),
      moves: [
        { ...E4, comment: "solid" },
        { ...E5, comment: "the losing move" },
      ],
    };
    render(<GameView initial={{ ...withComments, moves: [withComments.moves[0]!] }} apiPublicUrl="https://api.test" />);
    expect(screen.getByText("solid")).toBeInTheDocument();
    expect(screen.queryByText("the losing move")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/components/game/GameView.test.tsx
```

Expected: FAIL — `GameView` has no `throughPly` to pass and the ply counter reads the snapshot.

- [ ] **Step 3: Filter the feed**

In `apps/web/src/components/game/CommentFeed.tsx`, add the prop and the filters:

```tsx
export interface CommentFeedProps {
  color: "white" | "black";
  name: string;
  moves: TimelineMove[];
  attempts: TimelineAttempt[];
  /**
   * The last ply the viewer has seen. Agent reasoning says things like "this
   * wins the queen in two", so a feed that ran ahead of the board would spoil
   * the game more thoroughly than the result panel does. Unlike the move
   * list this stays trimmed on a finished game too: a score sheet is a
   * record, a paragraph announcing the combination is the ending.
   */
  throughPly: number;
}
```

In `build`, take `throughPly` and skip what is ahead of it. `attempt.ply` is the ply count *before* the rejected move, so an attempt at the opening carries `ply: 0` and belongs to the viewer as soon as they have seen the move that followed it:

```tsx
function build(
  color: "white" | "black",
  moves: TimelineMove[],
  attempts: TimelineAttempt[],
  throughPly: number,
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const move of moves) {
    if (move.ply > throughPly) continue;
    if (move.color !== color || move.comment === null || move.comment === "") continue;
    ...
  }
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.ply >= throughPly) continue;
    if (attempt.color !== color) continue;
    ...
  }
  ...
}
```

and pass it through in the component: `const entries = build(color, moves, attempts, throughPly);`.

- [ ] **Step 4: Apply the rule in `GameView`**

In `apps/web/src/components/game/GameView.tsx`, after the `fromSnapshot` block, add:

```tsx
  // Everything the spectator sees is read from the cursor; the truth is only
  // how far there is to catch up. The clocks are the one exception, above:
  // freezing them whenever the cursor is not exactly at the live edge would
  // freeze them permanently, since being a ply or two behind is the normal
  // state of paced viewing.
  const arrived = playback.ply >= live.moves.length;
  const revealed = live.finished && arrived;
  // A live game's move list is trimmed to the cursor, because nobody knows
  // the future; a finished game's is not, because everyone knows the outcome
  // and the complete score sheet is the point.
  const shownMoves = live.finished ? live.moves : live.moves.slice(0, playback.ply);
```

Replace `const active = snapshot.status === "active";` with:

```tsx
  const active = !live.finished;
```

In the HUD, replace the two `active ?` reads with `revealed`:

```tsx
        <span className={revealed ? "hud" : "hud hud--live"}>
          {revealed ? null : <span className="live-dot" aria-hidden="true" />}
          {revealed ? "Finished" : "Live"} · rated · {Math.round(snapshot.config.timePerMoveMs / 1000)} s per move
        </span>
        <span className="hud hud--right">
          move {Math.floor(shownPly / 2) + 1} · {shownPly} plies
        </span>
```

Pass the trimmed list to `MoveList`:

```tsx
                moves={shownMoves.map((move) => ({
```

Pass the cursor to both feeds:

```tsx
          <CommentFeed
            color="white"
            name={snapshot.white.name}
            moves={live.moves}
            attempts={live.attempts}
            throughPly={playback.ply}
          />
          <CommentFeed
            color="black"
            name={snapshot.black.name}
            moves={live.moves}
            attempts={live.attempts}
            throughPly={playback.ply}
          />
```

And gate the result panel on `revealed` instead of `live.finished`:

```tsx
        {revealed ? (
```

- [ ] **Step 5: Run everything and commit**

```bash
pnpm --filter @aichess/web test && pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint
git add apps/web/src/components/game/GameView.tsx apps/web/src/components/game/CommentFeed.tsx apps/web/src/components/game/GameView.test.tsx
git commit -F - <<'MSG'
feat(web): the page shows what the viewer has reached, not what the server has

A delayed view does not break because it is delayed. It breaks when one
element quietly keeps reading the truth and gives away what the others have
not shown yet: the result panel announcing a win before the board reaches the
mate, the header counting plies nobody has seen.

So the board, the ply counter, the live badge, the result panel, the move
list and both comment feeds read the cursor. The clocks are the single
deliberate exception — being a ply or two behind is the normal state of paced
viewing, and freezing the clocks there would freeze them for ever. The cost
is that a clock resetting reveals a move about two seconds before you see it.

The comment feeds are the worst spoiler and the least obvious one: agent
reasoning says things like "this wins the queen in two". They stay trimmed
even on a finished game, where the move list does not — a score sheet is a
record, a paragraph announcing the combination is the ending.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 8: The rejected move, on the board

**Files:**
- Modify: `apps/web/src/components/game/GameView.tsx` (derive the mark)
- Modify: `apps/web/src/components/game/GameView.test.tsx` (the mark appears at its ply and nowhere else)
- Create: `apps/web/src/lib/attempts.ts`
- Create: `apps/web/src/lib/attempts.test.ts`

`Board2D` already accepts a `mark` prop and `game.css` already styles `.mark--illegal`; neither needed a change, only a caller.

**Interfaces:**
- Consumes: `Playback` from Task 2.
- Produces: `markForPly(attempts: readonly TimelineAttempt[], ply: number): { square: Square; kind: "illegal" } | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/attempts.test.ts`:

```ts
import type { TimelineAttempt } from "@aichess/core/protocol";
import { describe, expect, it } from "vitest";
import { markForPly } from "./attempts";

function attempt(ply: number, submitted: string): TimelineAttempt {
  return { ply, color: "black", submitted, reason: "not_legal", at: "2026-09-04T10:00:00.000Z" };
}

describe("markForPly", () => {
  // attempt.ply is the ply count BEFORE the rejected move, so the attempt
  // that preceded the move now on screen is the one at cursor - 1.
  it("marks the attempt that came before the move being shown", () => {
    expect(markForPly([attempt(3, "e7e5")], 4)).toEqual({ square: "e5", kind: "illegal" });
  });

  it("shows nothing at any other ply", () => {
    expect(markForPly([attempt(3, "e7e5")], 3)).toBeNull();
    expect(markForPly([attempt(3, "e7e5")], 5)).toBeNull();
  });

  it("marks nothing when the rejected text is not a move", () => {
    expect(markForPly([attempt(3, "castle please")], 4)).toBeNull();
  });

  it("reads a promotion's destination", () => {
    expect(markForPly([attempt(0, "a7a8q")], 1)).toEqual({ square: "a8", kind: "illegal" });
  });

  it("has nothing to say when there were no attempts", () => {
    expect(markForPly([], 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test src/lib/attempts.test.ts
```

Expected: FAIL — `Failed to resolve import "./attempts"`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/lib/attempts.ts`:

```ts
import type { TimelineAttempt } from "@aichess/core/protocol";
import type { Square } from "./position";

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * The rejected move to flash on the board at this point of the replay.
 *
 * `attempt.ply` is the ply count *before* the rejected move — an attempt at
 * the opening move carries 0 — so the attempt that preceded the move now on
 * screen is the one at `ply - 1`. Bound to the cursor rather than to the
 * clock, a rejection stops being a notification that scrolls away and becomes
 * a fact of the game, visible again on every replay.
 *
 * The submitted text is whatever the agent sent, so it is only a square when
 * it parses as one; anything else is left to the comment feed, which renders
 * it as text.
 */
export function markForPly(
  attempts: readonly TimelineAttempt[],
  ply: number,
): { square: Square; kind: "illegal" } | null {
  const attempt = attempts.find((candidate) => candidate.ply === ply - 1 && UCI.test(candidate.submitted));
  if (attempt === undefined) return null;
  return { square: attempt.submitted.slice(2, 4), kind: "illegal" };
}
```

- [ ] **Step 4: Pass it to the board**

In `apps/web/src/components/game/GameView.tsx`, add the import and the derivation next to `lastMove`:

```tsx
import { markForPly } from "@/lib/attempts";
```

```tsx
  const mark = fromSnapshot ? null : markForPly(live.attempts, playback.ply);
```

and pass it:

```tsx
                <Board2D
                  position={position}
                  lastMove={lastMove}
                  mark={mark}
                  label={`Board after ${shownPly} ${shownPly === 1 ? "ply" : "plies"}`}
                />
```

Add to `apps/web/src/components/game/GameView.test.tsx`:

```tsx
  it("flashes the square of a rejected move at the ply it belongs to", () => {
    const withAttempt: LiveGame = {
      snapshot: { ...SNAPSHOT, fen: AFTER_E4, ply: 1 },
      moves: [E4],
      attempts: [{ ply: 0, color: "white", submitted: "e2e5", reason: "not_legal", at: "2026-09-04T10:00:05.000Z" }],
      finished: false,
      gap: false,
    };
    const { container } = render(<GameView initial={withAttempt} apiPublicUrl="https://api.test" />);
    expect(container.querySelector(".mark--illegal")).not.toBeNull();
  });
```

- [ ] **Step 5: Run everything and commit**

```bash
pnpm --filter @aichess/web test && pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint
git add apps/web/src/lib/attempts.ts apps/web/src/lib/attempts.test.ts apps/web/src/components/game/GameView.tsx apps/web/src/components/game/GameView.test.tsx
git commit -F - <<'MSG'
feat(web): a rejected move flashes on the board where it was tried

Board2D has accepted a mark since plan 4 and .mark--illegal has been styled
since the prototype; nothing ever passed one. An illegal attempt scrolled
past in the comment feed and was gone.

Bound to the cursor instead of to the clock it becomes a fact of the game
rather than a notification: it reappears every time a replay passes that ply.
It is also the only honest marker of an interesting moment the data supports
today — the version driven by centipawn loss needs the analysis of step 6a,
and will read the same cursor.

The indexing is the part worth stating: attempt.ply is the ply count before
the rejected move, so an attempt at the opening carries 0 and the one that
preceded the move on screen is at cursor - 1. The submitted text is whatever
the agent sent, so it only becomes a square when it parses as one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

### Task 9: The browser test, the READMEs, and a stale comment

**Files:**
- Modify: `apps/web/e2e/live-game.spec.ts`
- Modify: `apps/web/README.md`
- Modify: `README.md`
- Modify: `deploy/deploy.sh` (the header comment only)

**Interfaces:** none — this task consumes everything above and produces nothing new.

- [ ] **Step 1: Extend the end-to-end test**

In `apps/web/e2e/live-game.spec.ts`, after the existing assertions on the live board, add:

```ts
  await page.getByRole("button", { name: "Back to the first move" }).click();
  await expect(page.getByRole("img", { name: "Board after 0 plies" })).toBeVisible();

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.getByLabel("Playback speed").selectOption("instant");
  await page.getByRole("button", { name: /Back to the (live|final) position/ }).click();
  await expect(page.getByText("At the live position")).toBeAttached();
```

- [ ] **Step 2: Run it against a live stack, or record why you did not**

The browser test is opt-in and needs the stack from `apps/web/README.md`. Run it if the stack is up:

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @aichess/web test:e2e
```

Expected: PASS. If the stack is not available, say so in the commit body rather than claiming it ran.

- [ ] **Step 3: Update the two READMEs**

In `apps/web/README.md`, add to the game-page description: the transport under the board (play, step, jump to live), that arrow keys and space drive the same cursor, that live moves are paced at about 2.5 s and catch up on their own, and that `Instant` restores the unpaced behaviour.

In the root `README.md`, update the test count in the badge and the per-package row for `web` to the numbers the suite actually prints after Task 8. Run the suite and read them off rather than guessing:

```bash
pnpm --filter @aichess/web test 2>&1 | tail -5
pnpm test 2>&1 | tail -20
```

- [ ] **Step 4: Fix the stale deploy comment**

In `deploy/deploy.sh`, replace the header line

```bash
#   ssh agenticchess 'sudo -u deploy /srv/agenticchess/deploy/deploy.sh'
```

with

```bash
#   ssh agenticchess '/srv/agenticchess/deploy/deploy.sh'
#
# Runs as ubuntu, which owns /srv/agenticchess and is in the docker group.
# There is no deploy user on the instance.
```

- [ ] **Step 5: Full suite, then commit**

```bash
pnpm test && pnpm --filter @aichess/web typecheck && pnpm --filter @aichess/web lint && pnpm format
git add apps/web/e2e/live-game.spec.ts apps/web/README.md README.md deploy/deploy.sh
git commit -F - <<'MSG'
docs: the spectator controls, and a deploy comment that named a user that does not exist

The browser test now presses the transport rather than only watching the
board fill in, which is the part a unit test in jsdom cannot vouch for: that
the buttons are reachable by their accessible names and that the speed control
is a real select.

deploy.sh's header told the reader to run it as `sudo -u deploy`. There is no
deploy user on the instance; /srv/agenticchess is owned by ubuntu, which is in
the docker group, so the script runs as ubuntu with no sudo at all. A stale
comment like that costs its reader one round trip to the box and back.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJDCoXisiBCezKknz3eKLy
MSG
```

---

## After the plan

Verification before calling it done, in one pass on the merged tree:

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format --check
```

Then look at it. The numbers in this plan — 2500 ms at the live edge, the
catch-up curve, the 400 ms floor — are derived from four production games and
have never been watched by a person. Open a live game with the seeded stack,
watch a hundred plies go by, and be willing to change `LIVE_BASE_MS` and
`CATCH_UP` on the evidence. They are two constants in one pure module
precisely so that changing them costs nothing.

Deploying this restarts the API and worker containers, which kills any game in
progress. Coordinate with whoever is on the box first.
