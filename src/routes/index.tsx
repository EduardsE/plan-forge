import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FloatingToolbar } from "#/components/floating-toolbar";
import { NavRail } from "#/components/nav-rail";
import { ReadoutChip } from "#/components/readout-chip";
import { UnitsToggle } from "#/components/units-toggle";
import { ViewControls } from "#/components/view-controls";
import { WorkspaceHeader } from "#/components/workspace-header";
import { type CameraApi, createCameraReadoutStore } from "#/lib/camera";
import { createSampleRoom } from "#/lib/model";
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
	const cameraApiRef = useRef<CameraApi | null>(null);
	const [readoutStore] = useState(createCameraReadoutStore);
	const [canvasReady, setCanvasReady] = useState(false);
	useEffect(() => {
		setCanvasReady(true);
	}, []);

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
						/>
					</Suspense>
				)}
				<WorkspaceHeader mode={viewMode} />
				{viewMode !== "objects" && (
					<FloatingToolbar
						onZoomIn={() => cameraApiRef.current?.zoomIn()}
						onZoomOut={() => cameraApiRef.current?.zoomOut()}
						onZoomToFit={() => cameraApiRef.current?.zoomToFit()}
					/>
				)}
				<ViewControls viewMode={viewMode} onSelectMode={setViewMode} />
				<ReadoutChip mode={viewMode} cameraReadout={readoutStore} />
				{viewMode === "draw" && <UnitsToggle />}
			</div>
		</div>
	);
}
