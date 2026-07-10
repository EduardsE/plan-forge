import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface WorkspaceHeaderProps {
	mode: ViewMode;
	/** Corners placed so far in the draw draft; drives the draw status line. */
	draftCornerCount?: number;
	/** Catalog item mid-placement; drives the objects status line. */
	placingName?: string | null;
	/** Objects panel open (screen 1d): the header moves right to clear it. */
	shifted?: boolean;
}

interface StatusDef {
	/** Dot color + glow, matching the mockup's per-screen status indicator. */
	dot: string;
	text: string;
}

const STATUS_BY_MODE: Record<ViewMode, StatusDef> = {
	"3d": { dot: "#34d399", text: "Loft apartment — draft · saved just now" },
	"2d": { dot: "#34d399", text: "Loft apartment — draft · saved just now" },
	draw: { dot: "#f59e0b", text: "Drawing room outline" },
	objects: {
		dot: "#22d3ee",
		text: "Object library — drag an item onto the floor",
	},
};

function drawStatusText(cornerCount: number): string {
	if (cornerCount === 0) {
		return "Drawing room outline — click to place the first corner";
	}
	const noun = cornerCount === 1 ? "corner" : "corners";
	return `Drawing room outline — ${cornerCount} ${noun} placed`;
}

export function WorkspaceHeader({
	mode,
	draftCornerCount = 0,
	placingName = null,
	shifted = false,
}: WorkspaceHeaderProps) {
	const status = STATUS_BY_MODE[mode];
	let text = status.text;
	if (mode === "draw") text = drawStatusText(draftCornerCount);
	// The mockup's 1d status, with the live item name: dragging a card takes
	// over the objects status line until the drop or cancel.
	if (mode === "objects" && placingName) {
		text = `Placing “${placingName}” — drop to confirm`;
	}
	return (
		<div
			className={cn(
				"absolute top-8 transition-[left] duration-300",
				shifted ? "left-[404px]" : "left-10",
			)}
		>
			<h1 className="font-bold text-[28px] text-foreground tracking-[-0.01em]">
				PlanForge
			</h1>
			<div className="mt-[5px] flex items-center gap-2 text-[13px] text-muted-foreground">
				<span
					className="h-[7px] w-[7px] rounded-full"
					style={{
						background: status.dot,
						boxShadow: `0 0 8px ${status.dot}b3`,
					}}
				/>
				{text}
			</div>
		</div>
	);
}
