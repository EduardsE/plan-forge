import type { ViewMode } from "#/lib/view-mode";

interface WorkspaceHeaderProps {
	mode: ViewMode;
	/** Corners placed so far in the draw draft; drives the draw status line. */
	draftCornerCount?: number;
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
		text: "Placing “Sofa · 2-seat” — drop to confirm",
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
}: WorkspaceHeaderProps) {
	const status = STATUS_BY_MODE[mode];
	const text = mode === "draw" ? drawStatusText(draftCornerCount) : status.text;
	return (
		<div className="absolute left-10 top-8">
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
