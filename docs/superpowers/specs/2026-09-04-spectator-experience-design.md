# Spectator experience: replay, paced playback, piece identity

Date: 2026-09-04
Status: approved in brainstorming, awaiting document review

## Goal

Make a game watchable by a human. Three complaints, one cause: moves arrive
faster than anyone can read them, pieces jump between squares instead of
sliding, and there is no way to press play and watch a game back.

They are one feature, not three. All of them are about a single piece of
state — **which ply the viewer is looking at** — and about decoupling it from
the ply the server has reached. Built separately they would be three
components fighting over `GameView`; built together they are one cursor with
three speeds.

This work also lays the state the evaluation graph of roadmap step 6a will
plug into. The graph is a plot of centipawns against the same cursor: click a
point, the board goes there; scrub the board, the cursor on the graph
follows. Building the cursor now means 6a adds a chart and nothing else.

## What this does not do

- No server change. No migration, no protocol change, no new endpoint. Every
  byte this needs is already published by `GET /v1/games/:id/moves` and the
  spectator SSE stream.
- **No pacing in the arena.** `useLiveBoard` feeds the lobby's small boards,
  where instant is the correct behaviour: those cards are a status display,
  not a broadcast. They gain piece identity (so they animate) and nothing
  else.
- No pacing on the server. Delaying the arena would inflate `thinkTimeMs`,
  which is published per agent, and would turn a display choice into a rule of
  the competition. The delay belongs to the viewer, where it falsifies no
  data.
- No evaluation graph, no accuracy, no Stockfish. Roadmap step 6a.
- "Jump to the next interesting moment" ships here only in the form the data
  honestly supports today: the illegal-move attempts. The version driven by
  centipawn loss belongs to 6a, and will find the cursor waiting for it.

## 1. The playback cursor

`apps/web/src/hooks/useReplay.ts` becomes `usePlayback.ts`. The rename is
not cosmetic: the hook no longer answers "am I reviewing", it answers "which
ply is the viewer looking at", which is a question a live game has too.

### 1.1 Two booleans, not three modes

| `following` | `playing` | What the viewer sees | Reached by |
|---|---|---|---|
| true | — | Paced live, catching up on its own | initial state of an active game |
| false | true | An instant replay running | the play button |
| false | false | Parked on one move | clicking a move, arrow keys, pause |

`following` implies the cursor advances by itself whenever the list is ahead
of it, so `playing` is not consulted in that row; it is what the play button
means in review mode only. Following with nothing to show simply waits.

One transition is worth stating because it is not obvious: a replay of a game
that is **still being played** switches `following` back on when the cursor
reaches the last move, so the replay rejoins the broadcast by itself. On a
finished game it stops there.

Initial state: an active game opens at the live edge, following. A finished
game opens on the final position, parked — the archive shows a result, as it
does today. `restart()` sets the cursor to 0 and starts playing.

### 1.2 The pace is a pure function

In `apps/web/src/lib/playback.ts`, with no React in the file:

```ts
export const LIVE_BASE_MS = 2500;
export const LIVE_MIN_MS = 400;
export const REVIEW_BASE_MS = 1000;
export const CATCH_UP = 0.5;
export const MAX_LAG = 40;

export type Speed = 0.5 | 1 | 2 | "instant";

/** The delay before the cursor advances one ply while following live. */
export function liveInterval(lag: number, speed: Speed): number {
  if (speed === "instant") return 0;
  if (lag <= 0) return LIVE_BASE_MS;
  const factor = 1 + CATCH_UP * (lag - 1);
  return Math.max(LIVE_MIN_MS, Math.round(LIVE_BASE_MS / factor / speed));
}
```

At speed 1: lag 1 → 2500 ms, 2 → 1667, 3 → 1250, 4 → 1000, 5 → 833, 9 → 500,
11 → 417, 12 and beyond → 400, the floor.

**The lag has a fixed point.** Production games run at roughly 1500 ms per
move. The cursor stops falling behind where the interval equals the arrival
rate: `2500 / (1 + 0.5(L - 1)) = 1500`, so `L ≈ 2.3` moves. Falling behind
speeds the cursor up, catching up slows it down, and the system settles about
two moves back — enough to miss nothing, too little to notice. No threshold
rule is needed, and none is written.

Per speed, that equilibrium is: 2× never falls behind at all, 1× settles near
2 moves, 0.5× settles near 6. The lag indicator in the control bar is what
makes 0.5× honest rather than broken.

The single threshold that does exist covers a pathological case: past
`MAX_LAG` plies behind, the cursor jumps to the live edge instead of
fast-forwarding. That is the backgrounded tab, where browsers throttle timers
and the viewer returns to a minute of arrears they did not ask to watch. The
jump belongs to `nextPly(ply, total, following, speed)`, which decides *where*
the cursor goes next; `liveInterval` decides only *when*. Keeping the two
apart is what lets both be tables of values in the tests. `nextPly` takes the
speed because `instant` is the same kind of jump: the cursor goes straight to
the live edge rather than walking there one zero-length timeout at a time.

In review mode the interval is `REVIEW_BASE_MS / speed`, and `"instant"` maps
to the floor rather than to zero — pressing play must produce a replay, not a
jump to the end.

### 1.3 Speed

One control for both modes: `0.5× / 1× / 2× / instant`. `instant` restores
today's behaviour exactly, which makes the whole feature opt-out in one click.

The choice is **not** persisted. Remembering it in `localStorage` reads as an
obvious courtesy and is a trap: the server renders the default, the client
reads a different value, and the speed control hydrates with a mismatch. The
honest fixes are a post-mount state write — which the Next 16 lint rules
reject inside an effect — or a suppressed hydration warning. Neither is worth
a remembered dropdown. The default is 1×, every visit.

## 2. Piece identity, and the hole in the move list

### 2.1 The defect

`positionFromFen` (`lib/position.ts:82`) does
`position.set(square, { id: square, kind, square })`. Identity **is** the
occupied square, so every update presents React with 32 new keys. React
unmounts and remounts every node, and `transition: transform 280ms steps(6)`
(`game.css:120`) never has two values to interpolate between. The symptom
reads as "there is no animation"; the cause is in a function that has nothing
to do with animation.

`steps(6)` is deliberate and stays — a stepped slide is the pixel-art idiom
the prototype established, not a smoothness bug.

### 2.2 The deeper defect

`applyStreamEvent` drops a move that does not continue the list and falls back
to the snapshot FEN (`live.ts:49`). This was a stated deviation in the plan-4
review: no timeline refetch. The hole opens when a move is played between the
server render and the subscription — that is, when opening almost any game in
progress — and `fromSnapshot` never goes false again, because the list can
never catch up. So the move list stays short for the whole session and the
board is FEN-drawn for the whole session.

With replay as a headline feature, a truncated move list is no longer
cosmetic: it is the feature, broken. The deviation is withdrawn.

### 2.3 Three fixes, in order of importance

1. **Close the hole.** When `applyStreamEvent` sees the discontinuity it
   records `gap: true` on the state; `useGameStream` fetches
   `/v1/games/:id/moves` once and rebuilds the list. The request is guarded
   against repeats. The FEN fallback returns to what it was meant to be:
   transient, a second or two.

2. **Transferable identity.** `positionFromFen(fen, previous?)` reconciles:
   pieces with the same square and kind keep their id, then within each kind a
   vacated square is matched to a newly occupied one. The arena's small boards
   need it because they are FEN by construction. But there they can do better:
   `game.move` carries `uci`, so `useLiveBoard` holds a `Position` and applies
   `applyUci` — exact identity, no heuristic — and reconciles from a FEN only
   on the opening snapshot. The lobby and arena start animating without having
   asked.

3. **The unwired vocabulary.** `.piece.is-captured` (the taken piece fades and
   scales) and `.mark--illegal` / `.piece.is-shaking` exist in the stylesheet
   and no component applies either.

   The illegal attempt is nearly free: `live.attempts` is already in
   `GameView` and `Board2D` already accepts a `mark` prop that nothing passes.
   Note the indexing — `attempt.ply` is the ply count *before* the rejected
   move, so an attempt at the opening move carries `ply: 0`. The attempt that
   preceded the move now on screen is the one with `ply === cursor - 1`.

   The captured-piece fade is **cut**, and the reason is worth recording
   because it is not obvious from the stylesheet. A CSS fade-out needs the
   node to be rendered visible first and to acquire the class on a later
   frame; a ghost that mounts already carrying `is-captured` mounts at
   `opacity: 0` and never animates. Doing it properly means a two-frame mount,
   which makes a currently pure component stateful for a small delight.
   `.piece.is-captured` stays in the stylesheet, unused, as it is today.

   Binding the attempt to the **cursor** rather than to the clock changes what
   it is. Today an illegal attempt scrolls past in the comment feed and is
   gone; driven by the cursor it reappears every time a replay passes that
   ply. It becomes a fact of the game rather than a notification — and it is
   the only honest "interesting moment" marker until analysis exists.

   This item is the first thing to cut if the plan needs to be smaller.

## 3. What the viewer reads

The rule: **everything the spectator sees is read from the cursor.** The truth
is used only to know how far there is to catch up.

| Element | Reads | Why |
|---|---|---|
| Board, last-move highlight, marks | cursor | it is the position being shown |
| Ply counter in the header | cursor | otherwise it says 42 while you see 40 |
| Move list | cursor **while the game is active** | see below |
| Comment feeds | cursor, always | the worst spoiler of all: the reasoning says "mate in two" before the board shows it |
| Live / Finished badge | cursor | "Finished" arrives when you do |
| Result panel | cursor | the real spoiler: the outcome before the mate |
| Player clocks | **truth, while following** | deliberate exception, see below |

**The move list is trimmed to the cursor only while the game is active.** On a
finished game the outcome is already known and the complete score sheet is the
point; hiding moves as a replay advances would be theatre. While the game is
live nobody knows the future, so trimming is honest — and at the equilibrium
lag the list is two rows short, which nobody notices.

The comment feeds are trimmed to the cursor even on a finished game, unlike
the move list. A score sheet is a record and reads as one; a paragraph of
prose announcing the combination three moves before you see it is not a
record, it is the ending. `CommentFeed` therefore takes the cursor and filters
on it, and so does the illegal-attempt list it shares.

**The clock is the exception.** Freezing it whenever the cursor is not exactly
at the live edge would freeze it permanently, because being slightly behind is
the *normal* state of paced viewing. So it runs while `following && active`
and stops only when the viewer has parked on a move. The cost is a small leak:
the clock resetting reveals that a move was played about two seconds before
you see it. That is accepted, and it is what makes the page feel alive.

## 4. Components and files

New:

- `apps/web/src/lib/playback.ts` — `liveInterval`, `reviewInterval`,
  `nextPly`, the constants. No React.
- `apps/web/src/hooks/usePlayback.ts` — replaces `useReplay.ts`.
- `apps/web/src/components/game/PlaybackBar.tsx` — `⏮ ◀ ▶/⏸ ▶| ⏭`, the speed
  control, and the "3 moves behind" indicator when the lag exceeds a couple of
  plies. Every button carries an `aria-label`; one `aria-live="polite"` region
  announces state ("at the live position", "3 moves behind") and never
  announces moves, which at one every 2.5 s would flood a screen reader.

Changed:

- `lib/position.ts` — reconciliation.
- `lib/live.ts` — the `gap` flag.
- `hooks/useGameStream.ts` — the one-shot timeline refetch.
- `lib/api.ts` — a client-side timeline read.
- `hooks/useLiveBoard.ts` — holds a `Position`, applies `uci`.
- `components/board/Board2D.tsx` — passes the `mark` it already accepts.
- `components/game/GameView.tsx` — the table in section 3, including the
  trimming of the move list, which is done by the caller so `MoveList` stays
  a component that renders exactly the moves it is handed.
- `components/game/CommentFeed.tsx` — filtered by the cursor.
- `components/arena/LiveBoardCard.tsx` — consumes the position.
- `styles/game.css`, `styles/arena.css`.
- `deploy/deploy.sh` — the header says to run it as `sudo -u deploy`; there is
  no `deploy` user on the instance, `/srv/agenticchess` is owned by `ubuntu`,
  and `ubuntu` is in the docker group. A stale comment that costs a round trip
  exactly once.

Keyboard: arrow keys and Home/End keep working as they do today; the space bar
becomes play/pause.

## 5. Testing

With the tools plan 4 already established: `renderHook`/`act` from Testing
Library, jsdom, and the `FakeEventSource` pattern in `useLiveBoard.test.tsx`.

| What | How |
|---|---|
| `liveInterval`, `reviewInterval`, `nextPly` | a table of values, no timers — including the fixed point near lag 2 and the jump past `MAX_LAG` |
| `positionFromFen` with a previous position | before/after positions asserting ids survive a capture, castling, en passant and promotion |
| `usePlayback` | `vi.useFakeTimers()` and `act`: the three rows of the table in 1.1, and the automatic rejoin |
| The hole | a `FakeEventSource` emitting a non-contiguous move, a stubbed `fetch`, asserting **exactly one** request |
| The anti-spoiler rule | one case per row of the table in section 3, with cursor and truth deliberately divergent |
| End to end (opt-in) | extend `apps/web/e2e/live-game.spec.ts`: press play, assert the board changes |

Game `8a686658-c24c-4267-aefd-08b08543eae0` in production is the only one of
the four that contains a real illegal-move attempt, which makes it the fixture
for the shake. It is worth not losing.

## 6. Risks and deliberate compromises

1. **React 19 strict mode mounts effects twice in development.** The timer
   must be created and destroyed idempotently, or the cursor advances at
   double speed under `next dev` only — invisible in production and unpleasant
   to diagnose. This is the reason the pace calculation lives in a pure module
   outside the hook: the fragile part stays a few lines around a timer, and
   the part with the logic never touches React.

2. **Reconciliation is a heuristic** when more than one move separates two
   FENs. Where the matching is ambiguous it degrades to remounting, which is
   today's behaviour: no regression, but no guarantee either. The exact path
   (`applyUci` from the stream) is the one that carries the live case.

3. **The clock leak** in section 3 is accepted, not overlooked.

4. **The captured-piece fade is dropped** for the reason given in 2.3: a
   fade-out cannot animate from a fresh mount, and buying it means making
   `Board2D` stateful. `.piece.is-captured` stays unused in the stylesheet.

5. **The speed is not remembered between visits**, deliberately, to avoid a
   hydration mismatch on the one control that would show it.

## 7. Rollout

Web only: no image rebuild, no migration, no API change. But `deploy.sh`
restarts the containers, which kills a game in progress, so the deploy is
coordinated with whoever is on the box — the same protocol as the previous
deployments.
