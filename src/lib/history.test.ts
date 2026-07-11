import { describe, expect, it } from "vitest";
import {
  commitHistory,
  createHistory,
  HISTORY_LIMIT,
  type History,
  previewHistory,
  redoHistory,
  settleHistory,
  undoHistory,
} from "./history";

/** A tiny plain-data stand-in for the room model. */
interface State {
  items: number[];
}

const state = (...items: number[]): State => ({ items });

describe("createHistory", () => {
  it("starts settled with empty stacks", () => {
    const h = createHistory(state(1));
    expect(h.current).toEqual(state(1));
    expect(h.baseline).toBe(h.current);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
  });
});

describe("commitHistory", () => {
  it("pushes the previous state as an undo step", () => {
    const h = commitHistory(createHistory(state(1)), state(1, 2));
    expect(h.current).toEqual(state(1, 2));
    expect(h.baseline).toEqual(state(1, 2));
    expect(h.past).toEqual([state(1)]);
  });

  it("clears the redo stack", () => {
    let h = commitHistory(createHistory(state(1)), state(2));
    h = undoHistory(h);
    expect(h.future).toEqual([state(2)]);
    h = commitHistory(h, state(3));
    expect(h.future).toEqual([]);
  });

  it("drops the oldest step past the limit", () => {
    let h: History<State> = createHistory(state(0));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      h = commitHistory(h, state(i));
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toEqual(state(5));
  });
});

describe("previewHistory / settleHistory", () => {
  it("previews without creating undo steps", () => {
    let h = createHistory(state(1));
    h = previewHistory(h, state(1, 2));
    h = previewHistory(h, state(1, 3));
    expect(h.current).toEqual(state(1, 3));
    expect(h.baseline).toEqual(state(1));
    expect(h.past).toEqual([]);
  });

  it("settle folds a whole gesture into one undo step", () => {
    let h = createHistory(state(1));
    h = previewHistory(h, state(1, 2));
    h = previewHistory(h, state(1, 3));
    h = settleHistory(h);
    expect(h.past).toEqual([state(1)]);
    expect(h.baseline).toEqual(state(1, 3));
  });

  it("a gesture that returns to its start settles to nothing", () => {
    let h = createHistory(state(1));
    // Esc restore: same values, different object identity.
    h = previewHistory(h, state(1, 2));
    h = previewHistory(h, state(1));
    const settled = settleHistory(h);
    expect(settled.past).toEqual([]);
    expect(settled).toBe(h);
  });
});

describe("undoHistory / redoHistory", () => {
  it("round-trips through the stacks", () => {
    let h = commitHistory(createHistory(state(1)), state(2));
    h = commitHistory(h, state(3));
    h = undoHistory(h);
    expect(h.current).toEqual(state(2));
    h = undoHistory(h);
    expect(h.current).toEqual(state(1));
    expect(h.past).toEqual([]);
    h = redoHistory(h);
    h = redoHistory(h);
    expect(h.current).toEqual(state(3));
    expect(h.future).toEqual([]);
  });

  it("undo is a no-op on an empty past", () => {
    const h = createHistory(state(1));
    expect(undoHistory(h)).toBe(h);
  });

  it("redo is a no-op on an empty future", () => {
    const h = commitHistory(createHistory(state(1)), state(2));
    expect(redoHistory(h)).toBe(h);
  });

  it("undo mid-gesture settles first, reverting the in-flight change", () => {
    let h = commitHistory(createHistory(state(1)), state(2));
    h = previewHistory(h, state(2, 9));
    h = undoHistory(h);
    expect(h.current).toEqual(state(2));
    expect(h.future).toEqual([state(2, 9)]);
  });

  it("redo mid-gesture settles, which clears the redo stack", () => {
    let h = commitHistory(createHistory(state(1)), state(2));
    h = undoHistory(h);
    h = previewHistory(h, state(1, 9));
    h = redoHistory(h);
    expect(h.current).toEqual(state(1, 9));
    expect(h.future).toEqual([]);
  });
});
