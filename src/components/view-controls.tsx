import { Grid2x2, Magnet, Maximize } from "lucide-react";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface ViewControlsProps {
	viewMode: ViewMode;
	onSelectMode: (mode: ViewMode) => void;
	/** Objects panel open (screen 1d): the controls move right to clear it. */
	shifted?: boolean;
}

const GLASS_SURFACE = {
	background: "var(--surface-glass)",
	border: "1px solid var(--border-subtle)",
	boxShadow: "var(--shadow-md)",
	backdropFilter: "blur(16px)",
} as const;

interface ToggleButtonDef {
	label: string;
	icon: typeof Grid2x2;
	/** Persistently on in the mockup (grid/snap); fullscreen is a plain action. */
	active: boolean;
}

const TOGGLE_BUTTONS: ToggleButtonDef[] = [
	{ label: "Toggle grid", icon: Grid2x2, active: true },
	{ label: "Toggle snapping", icon: Magnet, active: true },
	{ label: "Fullscreen", icon: Maximize, active: false },
];

/**
 * Bottom-left view controls, matching the mockup's screens 1a–1d:
 * a segmented 2D|3D pill plus a grid/snap/fullscreen button group.
 *
 * The 2D|3D pill is the only interactive chrome in Phase 1 — it reads and
 * mutates the shared `viewMode`. 2D reads active for the top-down lenses
 * ("2d" and draw mode, screen 1c); 3D reads active for the dollhouse lenses
 * ("3d" and objects mode, screen 1d) — mirroring which segment glows on each
 * mockup screen. Grid/snap render toggled-on and fullscreen as a plain action;
 * all three are no-op stubs until Phase 4 wires up real behavior.
 */
export function ViewControls({
	viewMode,
	onSelectMode,
	shifted = false,
}: ViewControlsProps) {
	const is2dActive = viewMode === "2d" || viewMode === "draw";

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
				{TOGGLE_BUTTONS.map(({ label, icon: Icon, active }) => (
					<button
						key={label}
						type="button"
						aria-label={label}
						onClick={() => {}}
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
