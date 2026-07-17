import type { DrawTool } from "#/components/draw-tool-stack";

/**
 * Bottom-center helper hint bar for draw mode (mockup screen 1c): what a click
 * does, in a dark ink pill (the one dark element on the Paper canvas, like the
 * tooltips). The copy tracks the active tool — the rect tool swaps to its
 * two-click gesture; the wall/select tools show the live graph gestures (drag
 * any corner, chain walls, split, delete).
 */

function Key({ children }: { children: string }) {
  return (
    <span className="rounded-[5px] bg-white/10 px-[7px] py-px font-mono text-[12px]">
      {children}
    </span>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap text-[13px] text-[#d7d7d2]">
      {children}
    </span>
  );
}

const DIVIDER = <span className="text-white/25">·</span>;

export function DrawHintBar({
  tool,
  chaining = false,
}: {
  tool: DrawTool;
  /** A wall chain is in progress — esc ends it. */
  chaining?: boolean;
}) {
  return (
    <div className="-translate-x-1/2 absolute bottom-11 left-1/2 flex items-center gap-2.5 rounded-[9px] bg-[var(--ink-900)] px-4 py-2 shadow-[0_14px_34px_rgba(15,27,61,0.25)]">
      {tool === "rect" ? (
        <>
          <Hint>Click two opposite corners</Hint>
          {DIVIDER}
          <Hint>
            <Key>esc</Key> cancel
          </Hint>
        </>
      ) : tool === "wall" ? (
        <>
          <Hint>Click to chain walls</Hint>
          {DIVIDER}
          <Hint>Snaps onto existing walls &amp; corners</Hint>
          {chaining && (
            <>
              {DIVIDER}
              <Hint>
                <Key>esc</Key> ends the chain
              </Hint>
            </>
          )}
        </>
      ) : (
        <>
          <Hint>Drag corners anywhere</Hint>
          {DIVIDER}
          <Hint>Drag a wall to split it</Hint>
          {DIVIDER}
          <Hint>
            Click a wall, <Key>del</Key> removes it
          </Hint>
        </>
      )}
    </div>
  );
}
