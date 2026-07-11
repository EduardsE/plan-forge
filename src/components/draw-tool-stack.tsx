import type { ComponentProps, JSX } from "react";
import { Tooltip } from "#/components/tooltip";
import { cn } from "#/lib/utils";

export type DrawTool = "select" | "wall" | "rect";

/**
 * The vertical draw tool stack (mockup screen 1c), docked at the canvas's top-left. Select stops corner placement (and, over an existing room, is the
 * reshaping mode); wall places outline corners click-by-click; rect draws a
 * rectangular room from two opposite-corner clicks. (The mockup's arc-wall and
 * split-wall stubs were dropped — arcs aren't in the straight-segment wall
 * model, and wall splitting already lives in the reshaping flow.)
 *
 * The icons are the mockup's inline SVGs verbatim — none of them has a close
 * lucide equivalent (e.g. the wall tool's line-with-endpoint-dots).
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

interface ToolDef {
  tool: DrawTool;
  label: string;
  icon: JSX.Element;
}

const TOOLS: ToolDef[] = [
  {
    tool: "select",
    label: "Select",
    icon: (
      <IconSvg>
        <path d="M5 3l4.5 12 1.8-4.7L16 8.5 5 3z" />
      </IconSvg>
    ),
  },
  {
    tool: "wall",
    label: "Draw walls",
    icon: (
      <IconSvg>
        <path d="M5 15L15 5" />
        <circle cx="5" cy="15" r="1.8" />
        <circle cx="15" cy="5" r="1.8" />
      </IconSvg>
    ),
  },
  {
    tool: "rect",
    label: "Rectangle room",
    icon: (
      <IconSvg>
        <rect x="3.5" y="5" width="13" height="10" rx="1" />
      </IconSvg>
    ),
  },
];

interface DrawToolStackProps {
  tool: DrawTool;
  onToolChange: (tool: DrawTool) => void;
}

export function DrawToolStack({ tool, onToolChange }: DrawToolStackProps) {
  return (
    <div
      className="absolute top-5 left-5 flex flex-col gap-1 rounded-[10px] border border-[var(--control-border)] bg-[var(--frame)] p-1"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {TOOLS.map(({ tool: id, label, icon }) => {
        const isActive = id === tool;
        return (
          <Tooltip key={id} label={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => onToolChange(id)}
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
