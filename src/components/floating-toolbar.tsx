import { Crosshair, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Tooltip } from "#/components/tooltip";
import { cn } from "#/lib/utils";

interface ToolbarButtonDef {
	label: string;
	icon: typeof Undo2;
	disabled?: boolean;
	onClick?: () => void;
}

interface FloatingToolbarProps {
	onUndo?: () => void;
	onRedo?: () => void;
	/** Steps available on the room history — dimmed like mockup 1a's redo
	 * when there's nothing to step to (or history is out, in draw mode). */
	canUndo?: boolean;
	canRedo?: boolean;
	onZoomIn?: () => void;
	onZoomOut?: () => void;
	onZoomToFit?: () => void;
	/** Objects panel open (screen 1d): the whole bar moves right to clear it. */
	shifted?: boolean;
}

/**
 * Floating undo/redo + zoom toolbar, present on all four mockup screens —
 * on 1d it sits at left 404px, clear of the objects panel.
 * Undo/redo step the room history and the zoom buttons drive the camera
 * rig, all via the handler props.
 */
export function FloatingToolbar({
	onUndo,
	onRedo,
	canUndo = false,
	canRedo = false,
	onZoomIn,
	onZoomOut,
	onZoomToFit,
	shifted = false,
}: FloatingToolbarProps) {
	const buttons: ToolbarButtonDef[] = [
		{ label: "Undo", icon: Undo2, disabled: !canUndo, onClick: onUndo },
		{ label: "Redo", icon: Redo2, disabled: !canRedo, onClick: onRedo },
		{ label: "Zoom in", icon: ZoomIn, onClick: onZoomIn },
		{ label: "Zoom out", icon: ZoomOut, onClick: onZoomOut },
		{ label: "Fit to view", icon: Crosshair, onClick: onZoomToFit },
	];

	return (
		<div
			className={cn(
				"absolute top-[116px] flex gap-1 rounded-2xl p-1.5 transition-[left] duration-300",
				shifted ? "left-[404px]" : "left-10",
			)}
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
					<Tooltip label={label} side="bottom">
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
					</Tooltip>
				</div>
			))}
		</div>
	);
}
