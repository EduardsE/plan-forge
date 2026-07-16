import { FilePlus2, Maximize, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip } from "#/components/tooltip";
import { formatSavedStatus } from "#/lib/persistence";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface WorkspaceHeaderProps {
  mode: ViewMode;
  /** Room display name, the breadcrumb leaf. */
  roomName: string;
  /** Epoch ms of the last autosave, or null before anything was saved. */
  savedAt: number | null;
  /** "New room" escape hatch: clear the room + autosave, start drawing. */
  onNewRoom: () => void;
  /** The centered 2D|3D switch mutates the shared view mode. */
  onSelectMode: (mode: ViewMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** "Present" = browser fullscreen on the workspace pane. */
  onFullscreen: () => void;
  /** Draw mode is editing the existing outline, not drawing a fresh one. */
  draftClosed?: boolean;
  /** Catalog item mid-placement; flips the status chip to "Placing". */
  placingName?: string | null;
}

/** How often the "Saved N min ago" chip re-renders to stay truthful. */
const SAVED_TICK_MS = 30_000;

/** The green "Saved" chip, made real from the autosave timestamp. */
function SavedChip({ savedAt }: { savedAt: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (savedAt === null) return;
    const id = setInterval(() => setTick((tick) => tick + 1), SAVED_TICK_MS);
    return () => clearInterval(id);
  }, [savedAt]);
  if (savedAt === null) {
    return <StatusChip tone="neutral">Draft</StatusChip>;
  }
  const text = formatSavedStatus(savedAt, Date.now());
  return (
    <StatusChip tone="green">
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </StatusChip>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "green" | "blue" | "neutral";
  children: React.ReactNode;
}) {
  const color =
    tone === "green"
      ? "var(--saved-green)"
      : tone === "blue"
        ? "var(--blue)"
        : "var(--ink-400)";
  const bg =
    tone === "green"
      ? "rgba(30, 158, 106, 0.1)"
      : tone === "blue"
        ? "var(--blue-tint)"
        : "var(--well)";
  return (
    <span
      className="flex items-center gap-1.5 rounded-[7px] px-[9px] py-1 text-[12px]"
      style={{ color, background: bg }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

/**
 * The 56px header (screen 2b): breadcrumb + contextual status chip on the
 * left, the flat 2D|3D segmented switch dead center, and the action cluster —
 * joined undo/redo group, New room, Present (fullscreen) — on the right.
 */
export function WorkspaceHeader({
  mode,
  roomName,
  savedAt,
  onNewRoom,
  onSelectMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onFullscreen,
  draftClosed = false,
  placingName = null,
}: WorkspaceHeaderProps) {
  // Activity beats autosave on the chip: an armed opening tool, a live
  // placement drag, or draw mode each announce themselves in blue.
  let chip = <SavedChip savedAt={savedAt} />;
  if (mode === "draw") {
    chip = (
      <StatusChip tone="blue">
        {draftClosed ? "Editing outline" : "Drawing"}
      </StatusChip>
    );
  } else if (placingName) {
    chip = <StatusChip tone="blue">Placing</StatusChip>;
  }
  const is2dActive = mode === "2d" || mode === "draw";

  return (
    <header
      className="grid grid-cols-[1fr_auto_1fr] items-center border-[var(--hairline)] border-b bg-[var(--frame)] px-4"
      style={{ gridArea: "header" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-[7px] text-[13.5px]">
          <span className="text-[var(--ink-500)]">PlanForge</span>
          <span aria-hidden="true" className="text-[var(--ink-250)]">
            /
          </span>
          <h1 className="font-semibold text-[13.5px] text-[var(--ink-900)]">
            {roomName}
          </h1>
        </div>
        {chip}
      </div>

      <div className="flex gap-0.5 rounded-[9px] border border-[var(--control-border)] bg-[var(--well)] p-[3px]">
        {(["2d", "3d"] as const).map((lens) => {
          const isActive = lens === "2d" ? is2dActive : !is2dActive;
          return (
            <button
              key={lens}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelectMode(lens)}
              className={cn(
                "rounded-[7px] px-[18px] py-1.5 text-[13px]",
                isActive
                  ? "bg-[var(--frame)] font-semibold text-[var(--ink-900)]"
                  : "font-medium text-[var(--ink-500)] hover:text-[var(--ink-700)]",
              )}
              style={
                isActive ? { boxShadow: "var(--shadow-control)" } : undefined
              }
            >
              {lens.toUpperCase()}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <div className="flex rounded-[8px] border border-[var(--control-border)] bg-[var(--panel)] p-[2px]">
          {[
            { label: "Undo", icon: Undo2, disabled: !canUndo, onClick: onUndo },
            { label: "Redo", icon: Redo2, disabled: !canRedo, onClick: onRedo },
          ].map(({ label, icon: Icon, disabled, onClick }) => (
            <Tooltip key={label} label={label} side="bottom">
              <button
                type="button"
                aria-label={label}
                disabled={disabled}
                onClick={onClick}
                className={cn(
                  "flex h-7 w-[30px] items-center justify-center rounded-[6px]",
                  disabled
                    ? "cursor-not-allowed text-[var(--ink-250)]"
                    : "text-[var(--ink-600)] hover:bg-[var(--well)]",
                )}
              >
                <Icon width={17} height={17} strokeWidth={1.6} />
              </button>
            </Tooltip>
          ))}
        </div>
        <button
          type="button"
          onClick={onNewRoom}
          className="flex items-center gap-[7px] rounded-[8px] border border-[var(--button-border)] px-3.5 py-[7px] font-medium text-[13px] text-[var(--ink-700)] hover:bg-[var(--panel)]"
        >
          <FilePlus2 width={15} height={15} strokeWidth={1.7} />
          New room
        </button>
        <button
          type="button"
          onClick={onFullscreen}
          className="flex items-center gap-[7px] rounded-[8px] bg-[var(--blue)] px-3.5 py-[7px] font-semibold text-[13px] text-white hover:brightness-110"
          style={{ boxShadow: "0 1px 2px rgba(58, 91, 240, 0.35)" }}
        >
          <Maximize width={15} height={15} strokeWidth={1.7} />
          Present
        </button>
      </div>
    </header>
  );
}
