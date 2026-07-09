import { Crosshair, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "#/lib/utils";

interface ToolbarButtonDef {
	label: string;
	icon: typeof Undo2;
	disabled?: boolean;
}

const ACTIONS: ToolbarButtonDef[] = [
	{ label: "Undo", icon: Undo2 },
	{ label: "Redo", icon: Redo2, disabled: true },
];

const ZOOM_ACTIONS: ToolbarButtonDef[] = [
	{ label: "Zoom in", icon: ZoomIn },
	{ label: "Zoom out", icon: ZoomOut },
	{ label: "Fit to view", icon: Crosshair },
];

/**
 * Floating undo/redo + zoom toolbar, matching the mockup's screens 1a/1b/1c
 * (absent on 1d, where the objects panel occupies this area).
 * Phase 1: static chrome only — buttons are no-ops until Phase 4 wires up
 * real history/viewport state.
 */
export function FloatingToolbar() {
	const buttons = [...ACTIONS, ...ZOOM_ACTIONS];

	return (
		<div
			className="absolute left-10 top-[116px] flex gap-1 rounded-2xl p-1.5"
			style={{
				background: "var(--surface-glass)",
				border: "1px solid var(--border-subtle)",
				boxShadow: "var(--shadow-md)",
				backdropFilter: "blur(16px)",
			}}
		>
			{buttons.map(({ label, icon: Icon, disabled }, index) => (
				<div key={label} className="flex items-center">
					{index === 2 && (
						<div
							className="mx-1 my-1.5 w-px self-stretch"
							style={{ background: "var(--border-subtle)" }}
							aria-hidden="true"
						/>
					)}
					<button
						type="button"
						aria-label={label}
						disabled={disabled}
						onClick={() => {}}
						className={cn(
							"flex h-10 w-10 items-center justify-center rounded-[10px] text-[var(--navy-500)]",
							"disabled:cursor-not-allowed disabled:text-[var(--navy-100)]",
							!disabled && "hover:bg-[var(--surface-alt)]",
						)}
					>
						<Icon width={20} height={20} strokeWidth={1.6} />
					</button>
				</div>
			))}
		</div>
	);
}
