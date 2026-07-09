import { Crosshair, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "#/lib/utils";

interface ToolbarButtonDef {
	label: string;
	icon: typeof Undo2;
	disabled?: boolean;
	onClick?: () => void;
}

interface FloatingToolbarProps {
	onZoomIn?: () => void;
	onZoomOut?: () => void;
	onZoomToFit?: () => void;
}

/**
 * Floating undo/redo + zoom toolbar, matching the mockup's screens 1a/1b/1c
 * (absent on 1d, where the objects panel occupies this area).
 * The zoom buttons drive the camera rig via the handler props; undo/redo
 * stay no-ops until Phase 4 wires up real history.
 */
export function FloatingToolbar({
	onZoomIn,
	onZoomOut,
	onZoomToFit,
}: FloatingToolbarProps) {
	const buttons: ToolbarButtonDef[] = [
		{ label: "Undo", icon: Undo2 },
		{ label: "Redo", icon: Redo2, disabled: true },
		{ label: "Zoom in", icon: ZoomIn, onClick: onZoomIn },
		{ label: "Zoom out", icon: ZoomOut, onClick: onZoomOut },
		{ label: "Fit to view", icon: Crosshair, onClick: onZoomToFit },
	];

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
			{buttons.map(({ label, icon: Icon, disabled, onClick }, index) => (
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
						onClick={onClick ?? (() => {})}
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
