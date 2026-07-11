import type { ComponentProps, JSX } from "react";
import { Tooltip } from "#/components/tooltip";
import type { OpeningKind } from "#/lib/model";
import { cn } from "#/lib/utils";

/**
 * The door/window tool stack on the 2D plan lens — same Paper card as the
 * draw tool stack (and the same spot; only one of them is ever on screen).
 * Clicking a tool arms it (click a wall to insert), clicking again or esc
 * disarms. The icons are the plan lens's own symbols: the door leaf + swing
 * arc, the window's broken wall band.
 */

function IconSvg(props: ComponentProps<"svg">) {
  return (
    <svg
      width={19}
      height={19}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

const TOOLS: Array<{ kind: OpeningKind; label: string; icon: JSX.Element }> = [
  {
    kind: "door",
    label: "Add door",
    icon: (
      <IconSvg>
        <path d="M5 16V5a11 11 0 0 1 11 11" />
        <circle cx="5" cy="16" r="1.4" />
      </IconSvg>
    ),
  },
  {
    kind: "window",
    label: "Add window",
    icon: (
      <IconSvg>
        <rect x="3" y="6.5" width="14" height="7" rx="1" />
        <path d="M3 10h14" />
      </IconSvg>
    ),
  },
];

interface OpeningToolStackProps {
  tool: OpeningKind | null;
  onToolChange: (tool: OpeningKind | null) => void;
}

export function OpeningToolStack({
  tool,
  onToolChange,
}: OpeningToolStackProps) {
  return (
    <div
      className="absolute top-5 left-5 flex flex-col gap-1 rounded-[10px] border border-[var(--control-border)] bg-[var(--frame)] p-1"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {TOOLS.map(({ kind, label, icon }) => {
        const isActive = kind === tool;
        return (
          <Tooltip key={kind} label={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => onToolChange(isActive ? null : kind)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-[8px]",
                isActive
                  ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                  : "text-[var(--ink-400)] hover:bg-[var(--well)] hover:text-[var(--ink-600)]",
              )}
            >
              {icon}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
