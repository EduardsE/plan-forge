import { createFileRoute } from "@tanstack/react-router";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { DrawHintBar } from "#/components/draw-hint-bar";
import { type DrawTool, DrawToolStack } from "#/components/draw-tool-stack";
import { FloatingToolbar } from "#/components/floating-toolbar";
import { NavRail } from "#/components/nav-rail";
import { ReadoutChip } from "#/components/readout-chip";
import { UnitsToggle } from "#/components/units-toggle";
import { ViewControls } from "#/components/view-controls";
import { WorkspaceHeader } from "#/components/workspace-header";
import { type CameraApi, createCameraReadoutStore } from "#/lib/camera";
import { setSegmentLength } from "#/lib/draw";
import { createSampleRoom, type Point } from "#/lib/model";
import type { Unit } from "#/lib/units";
import type { ViewMode } from "#/lib/view-mode";

// Loaded lazily after mount: the three.js scene is client-only, so keep it
// out of the SSR pass entirely.
const PlannerCanvas = lazy(() =>
	import("#/components/planner-canvas").then((module) => ({
		default: module.PlannerCanvas,
	})),
);

export const Route = createFileRoute("/")({ component: Planner });

function Planner() {
	const [viewMode, setViewMode] = useState<ViewMode>("3d");
	const [room, setRoom] = useState(createSampleRoom);
	const [unit, setUnit] = useState<Unit>("m");
	const cameraApiRef = useRef<CameraApi | null>(null);
	const [readoutStore] = useState(createCameraReadoutStore);
	const [canvasReady, setCanvasReady] = useState(false);
	useEffect(() => {
		setCanvasReady(true);
	}, []);

	// The draw-mode draft outline. Owned here (not by the canvas) so the
	// header's status line can count corners and closing can become the room.
	const [draft, setDraft] = useState<Point[]>([]);
	const [drawTool, setDrawTool] = useState<DrawTool>("wall");

	const placeCorner = useCallback(
		(point: Point) => setDraft((corners) => [...corners, point]),
		[],
	);
	const setDraftSegmentLength = useCallback(
		(segmentIndex: number, meters: number) =>
			setDraft((corners) => setSegmentLength(corners, segmentIndex, meters)),
		[],
	);
	const closeDraft = useCallback(() => {
		if (draft.length < 3) return;
		// The drawn outline becomes the room. Openings and furniture belonged
		// to the old outline (wall indices, positions) and don't carry over.
		setRoom((current) => ({
			name: current.name,
			outline: draft,
			openings: [],
			furniture: [],
		}));
		setDraft([]);
		setViewMode("2d");
	}, [draft]);
	const cancelDraft = useCallback(() => setDraft([]), []);

	// ⏎ closes the outline into the room model, esc cancels the draft —
	// unless the keystroke belongs to the inline length input.
	useEffect(() => {
		if (viewMode !== "draw") return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.target instanceof HTMLElement &&
				event.target.closest("input, textarea, [contenteditable]")
			) {
				return;
			}
			if (event.key === "Enter") closeDraft();
			else if (event.key === "Escape") cancelDraft();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [viewMode, closeDraft, cancelDraft]);

	return (
		<div className="flex h-screen w-screen overflow-hidden">
			<NavRail activeMode={viewMode} onSelectMode={setViewMode} />
			<div
				className="workspace-canvas relative flex-1"
				data-view-mode={viewMode}
			>
				{canvasReady && (
					<Suspense fallback={null}>
						<PlannerCanvas
							room={room}
							onRoomChange={setRoom}
							viewMode={viewMode}
							cameraApiRef={cameraApiRef}
							readoutStore={readoutStore}
							unit={unit}
							drawTool={drawTool}
							draftCorners={draft}
							onPlaceCorner={placeCorner}
							onSetDraftSegmentLength={setDraftSegmentLength}
							onRequestCloseDraft={closeDraft}
						/>
					</Suspense>
				)}
				<WorkspaceHeader mode={viewMode} draftCornerCount={draft.length} />
				{viewMode !== "objects" && (
					<FloatingToolbar
						onZoomIn={() => cameraApiRef.current?.zoomIn()}
						onZoomOut={() => cameraApiRef.current?.zoomOut()}
						onZoomToFit={() => cameraApiRef.current?.zoomToFit()}
					/>
				)}
				{viewMode === "draw" && (
					<>
						<DrawToolStack tool={drawTool} onToolChange={setDrawTool} />
						<DrawHintBar />
					</>
				)}
				<ViewControls viewMode={viewMode} onSelectMode={setViewMode} />
				<ReadoutChip mode={viewMode} cameraReadout={readoutStore} unit={unit} />
				{viewMode === "draw" && (
					<UnitsToggle unit={unit} onUnitChange={setUnit} />
				)}
			</div>
		</div>
	);
}
