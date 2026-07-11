/**
 * Bounded undo/redo snapshot history over plain-data state (the room model).
 *
 * Two kinds of change: `commitHistory` is one discrete user mutation = one
 * undo step (add/rotate/duplicate/delete, outline close), while
 * `previewHistory` streams the intermediate states of a continuous gesture
 * (a pointer drag) without touching the stacks. `settleHistory` closes a
 * gesture: the whole drag collapses into a single undo step, and a cancelled
 * drag — one that previewed back to exactly its starting state (esc) —
 * leaves no step at all.
 */

export interface History<T> {
  /** Live state, possibly mid-gesture. */
  current: T;
  /** Last committed state — what the next step pushed to `past` holds. */
  baseline: T;
  /** Undo stack, oldest step first. */
  past: T[];
  /** Redo stack, next redo first. */
  future: T[];
}

/** Snapshots kept before the oldest undo steps fall off the stack. */
export const HISTORY_LIMIT = 100;

export function createHistory<T>(state: T): History<T> {
  return { current: state, baseline: state, past: [], future: [] };
}

/** Snapshots are plain JSON data, so deep equality is a stringify away. */
function same<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function push<T>(history: History<T>, next: T): History<T> {
  return {
    current: next,
    baseline: next,
    past: [...history.past, history.baseline].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** One discrete mutation: the state so far becomes an undo step. */
export function commitHistory<T>(history: History<T>, next: T): History<T> {
  return push(settleHistory(history), next);
}

/** A mid-gesture state: replaces `current`, leaves the stacks alone. */
export function previewHistory<T>(history: History<T>, next: T): History<T> {
  return { ...history, current: next };
}

/**
 * Gesture over: fold whatever the previews changed into one undo step.
 * A gesture that ended back where it began leaves no step.
 */
export function settleHistory<T>(history: History<T>): History<T> {
  if (same(history.current, history.baseline)) return history;
  return push(history, history.current);
}

/**
 * Step back. An unsettled gesture settles first, so undo mid-drag reverts
 * the in-flight change rather than skipping past it.
 */
export function undoHistory<T>(history: History<T>): History<T> {
  const settled = settleHistory(history);
  if (settled.past.length === 0) return settled;
  const previous = settled.past[settled.past.length - 1];
  return {
    current: previous,
    baseline: previous,
    past: settled.past.slice(0, -1),
    future: [settled.baseline, ...settled.future],
  };
}

/**
 * Step forward again. New changes clear the redo stack (settling an
 * unsettled gesture counts), matching every editor's history semantics.
 */
export function redoHistory<T>(history: History<T>): History<T> {
  const settled = settleHistory(history);
  if (settled.future.length === 0) return settled;
  const next = settled.future[0];
  return {
    current: next,
    baseline: next,
    past: [...settled.past, settled.baseline],
    future: settled.future.slice(1),
  };
}
