import { Plus } from "lucide-react";
import { Tooltip } from "#/components/tooltip";
import { cn } from "#/lib/utils";

export interface FloorChipsProps {
  /** Every floor, ground-first (`building.floors` order) — the component
   * reverses this for display so the tallest storey sits on top, matching
   * how the building actually stacks. */
  floors: Array<{ id: string; label: string; name: string }>;
  activeFloorId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

/**
 * The building's floor stack, as a vertical chip rail (screen 2b's canvas
 * overlays): one small numbered/lettered chip per storey — "G" for the
 * ground floor, "2"/"3"… above it — plus an add button on top. Mirrors
 * `ZoomPill`'s overlay chrome (same border/frame/shadow tokens), docked at
 * the canvas's left edge instead of the bottom.
 */
export function FloorChips({
  floors,
  activeFloorId,
  onSelect,
  onAdd,
}: FloorChipsProps) {
  return (
    <div
      className="-translate-y-1/2 absolute top-1/2 left-5 z-10 flex flex-col items-center gap-1 rounded-[9px] border border-[var(--control-border)] bg-[var(--frame)] p-[3px]"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <Tooltip side="right" label="Add floor">
        <button
          type="button"
          aria-label="Add floor"
          onClick={onAdd}
          className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--ink-600)] hover:bg-[var(--well)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      {[...floors].reverse().map((f) => {
        const active = f.id === activeFloorId;
        return (
          <Tooltip key={f.id} side="right" label={f.name}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(f.id)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-[7px] font-mono text-[12px]",
                active
                  ? "bg-[var(--blue-tint)] text-[var(--blue)]"
                  : "text-[var(--ink-300)] hover:bg-[var(--well)]",
              )}
            >
              {f.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
