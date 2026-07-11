import { Box, Eye, Pencil, SlidersHorizontal, Sofa } from "lucide-react";
import { Tooltip } from "#/components/tooltip";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface NavRailProps {
  activeMode: ViewMode;
  onSelectMode: (mode: ViewMode) => void;
}

interface NavItemDef {
  label: string;
  icon: typeof Pencil;
  mode: ViewMode | null;
}

const NAV_ITEMS: NavItemDef[] = [
  { label: "Draw", icon: Pencil, mode: "draw" },
  { label: "Furnish", icon: Sofa, mode: "3d" },
  { label: "Objects", icon: Box, mode: "objects" },
  { label: "Views", icon: Eye, mode: "2d" },
  { label: "Settings", icon: SlidersHorizontal, mode: null },
];

/**
 * The 64px icon rail (screen 2b): logo tile up top (the one gradient the
 * Paper chrome allows), 40px icon-only buttons — active gets the blue tint
 * plus a 3px notch bar at the rail's left edge — settings pinned to the
 * bottom above the avatar dot.
 */
export function NavRail({ activeMode, onSelectMode }: NavRailProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex flex-col items-center gap-1 border-[var(--hairline)] border-r bg-[var(--panel)] pt-3.5 pb-4"
      style={{ gridArea: "rail" }}
    >
      <div
        className="mb-3 flex h-[34px] w-[34px] items-center justify-center rounded-[9px]"
        style={{
          background:
            "linear-gradient(140deg, var(--logo-from), var(--logo-to))",
        }}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 20 20"
          fill="none"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2L10 2.5z" />
          <path d="M3.5 6.2L10 10l6.5-3.8M10 10v7.5" />
        </svg>
      </div>

      {NAV_ITEMS.map(({ label, icon: Icon, mode }) => {
        const isActive = mode !== null && mode === activeMode;
        return (
          <Tooltip
            key={label}
            label={label}
            side="right"
            className={label === "Settings" ? "mt-auto" : undefined}
          >
            <button
              type="button"
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              onClick={mode === null ? undefined : () => onSelectMode(mode)}
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-[10px]",
                isActive
                  ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                  : "text-[var(--ink-400)] hover:text-[var(--ink-600)]",
              )}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-[9px] left-[-12px] h-[22px] w-[3px] rounded-[2px] bg-[var(--blue)]"
                />
              )}
              <Icon width={19} height={19} strokeWidth={1.6} />
            </button>
          </Tooltip>
        );
      })}

      <div
        className="mt-2.5 h-[30px] w-[30px] rounded-full"
        style={{
          background: "linear-gradient(140deg, #e8b48a, #b4633e)",
          boxShadow: "0 0 0 1px rgba(15, 27, 61, 0.1)",
        }}
      />
    </nav>
  );
}
