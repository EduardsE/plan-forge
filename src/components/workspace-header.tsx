import { useEffect, useState } from "react";
import { formatSavedStatus } from "#/lib/persistence";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface WorkspaceHeaderProps {
	mode: ViewMode;
	/** Room display name, shown in the 2D/3D status line. */
	roomName: string;
	/** Epoch ms of the last autosave, or null before anything was saved. */
	savedAt: number | null;
	/** "New room" escape hatch: clear the room + autosave, start drawing. */
	onNewRoom: () => void;
	/** Corners placed so far in the draw draft; drives the draw status line. */
	draftCornerCount?: number;
	/** Catalog item mid-placement; drives the objects status line. */
	placingName?: string | null;
	/** Objects panel open (screen 1d): the header moves right to clear it. */
	shifted?: boolean;
}

/** Dot color + glow per mode, matching the mockup's status indicator. */
const DOT_BY_MODE: Record<ViewMode, string> = {
	"3d": "#34d399",
	"2d": "#34d399",
	draw: "#f59e0b",
	objects: "#22d3ee",
};

/** How often the "saved N min ago" label re-renders to stay truthful. */
const SAVED_TICK_MS = 30_000;

function drawStatusText(cornerCount: number): string {
	if (cornerCount === 0) {
		return "Drawing room outline — click to place the first corner";
	}
	const noun = cornerCount === 1 ? "corner" : "corners";
	return `Drawing room outline — ${cornerCount} ${noun} placed`;
}

/** The mockup's "saved just now", made real from the autosave timestamp. */
function SavedStatus({ savedAt }: { savedAt: number | null }) {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (savedAt === null) return;
		const id = setInterval(() => setTick((tick) => tick + 1), SAVED_TICK_MS);
		return () => clearInterval(id);
	}, [savedAt]);
	if (savedAt === null) return null;
	return <> · {formatSavedStatus(savedAt, Date.now())}</>;
}

export function WorkspaceHeader({
	mode,
	roomName,
	savedAt,
	onNewRoom,
	draftCornerCount = 0,
	placingName = null,
	shifted = false,
}: WorkspaceHeaderProps) {
	// The 2D/3D lenses show the room itself: name, draft state, autosave age.
	const homeLens = mode === "3d" || mode === "2d";
	let text: React.ReactNode = (
		<>
			{roomName} — draft
			<SavedStatus savedAt={savedAt} />
		</>
	);
	if (mode === "draw") text = drawStatusText(draftCornerCount);
	// The mockup's 1d status, with the live item name: dragging a card takes
	// over the objects status line until the drop or cancel.
	if (mode === "objects") {
		text = placingName
			? `Placing “${placingName}” — drop to confirm`
			: "Object library — drag an item onto the floor";
	}
	const dot = DOT_BY_MODE[mode];
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
						background: dot,
						boxShadow: `0 0 8px ${dot}b3`,
					}}
				/>
				<span>{text}</span>
				{homeLens && (
					<>
						<span aria-hidden="true">·</span>
						<button
							type="button"
							onClick={onNewRoom}
							className="text-[13px] text-[var(--accent-teal-deep)] hover:underline"
						>
							New room
						</button>
					</>
				)}
			</div>
		</div>
	);
}
