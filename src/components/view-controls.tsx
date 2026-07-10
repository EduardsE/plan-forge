import { Grid2x2, Magnet, Maximize } from "lucide-react";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface ViewControlsProps {
	viewMode: ViewMode;
	onSelectMode: (mode: ViewMode) => void;
	/** Objects panel open (screen 1d): the controls move right to clear it. */
	shifted?: boolean;
	/** Whether the in-scene reference grid is shown (lit toggle). */
	gridVisible: boolean;
	onToggleGrid: () => void;
	/** Whether draw/placement snapping is active (lit toggle). */
	snapEnabled: boolean;
	onToggleSnap: () => void;
	/** Requests browser fullscreen on the workspace (a plain action). */
	onFullscreen: () => void;
}

const GLASS_SURFACE = {
	background: "var(--surface-glass)",
	border: "1px solid var(--border-subtle)",
	boxShadow: "var(--shadow-md)",
	backdropFilter: "blur(16px)",
} as const;

/**
 * Bottom-left view controls, matching the mockup's screens 1a–1d:
 * a segmented 2D|3D pill plus a grid/snap/fullscreen button group.
 *
 * The 2D|3D pill reads and mutates the shared `viewMode`. 2D reads active for
 * the top-down lenses ("2d" and draw mode, screen 1c); 3D reads active for the
 * dollhouse lenses ("3d" and objects mode, screen 1d) — mirroring which
 * segment glows on each mockup screen. Grid and snap are lit while their view-
 * state toggles are on; fullscreen is a plain action.
 */
export function ViewControls({
	viewMode,
	onSelectMode,
	shifted = false,
	gridVisible,
	onToggleGrid,
	snapEnabled,
	onToggleSnap,
	onFullscreen,
}: ViewControlsProps) {
	const is2dActive = viewMode === "2d" || viewMode === "draw";
	const toggleButtons = [
		{
			label: "Toggle grid",
			icon: Grid2x2,
			active: gridVisible,
			onClick: onToggleGrid,
		},
		{
			label: "Toggle snapping",
			icon: Magnet,
			active: snapEnabled,
			onClick: onToggleSnap,
		},
		{
			label: "Fullscreen",
			icon: Maximize,
			active: false,
			onClick: onFullscreen,
		},
	];

	return (
		<div
			className={cn(
				"absolute bottom-10 flex items-center gap-3 transition-[left] duration-300",
				shifted ? "left-[404px]" : "left-10",
			)}
		>
			<div className="flex rounded-full p-[5px]" style={GLASS_SURFACE}>
				{(["2d", "3d"] as const).map((mode) => {
					const isActive = mode === "2d" ? is2dActive : !is2dActive;
					return (
						<button
							key={mode}
							type="button"
							aria-pressed={isActive}
							onClick={() => onSelectMode(mode)}
							className={cn(
								"rounded-full px-[22px] py-[9px] text-[15px] font-semibold",
								isActive ? "text-white" : "text-[var(--navy-500)]",
							)}
							style={
								isActive
									? {
											background:
												"linear-gradient(135deg, var(--accent-cyan), var(--accent-teal))",
											boxShadow: "0 4px 16px rgba(20, 184, 166, 0.5)",
										}
									: undefined
							}
						>
							{mode.toUpperCase()}
						</button>
					);
				})}
			</div>

			<div className="flex gap-1 rounded-full p-[5px]" style={GLASS_SURFACE}>
				{toggleButtons.map(({ label, icon: Icon, active, onClick }) => (
					<button
						key={label}
						type="button"
						aria-label={label}
						aria-pressed={label === "Fullscreen" ? undefined : active}
						onClick={onClick}
						className={cn(
							"flex h-[38px] w-[38px] items-center justify-center rounded-full",
							active
								? "text-[var(--accent-teal-deep)]"
								: "text-[var(--navy-500)]",
						)}
						style={
							active ? { background: "rgba(45, 212, 207, 0.14)" } : undefined
						}
					>
						<Icon width={18} height={18} strokeWidth={1.6} />
					</button>
				))}
			</div>
		</div>
	);
}
