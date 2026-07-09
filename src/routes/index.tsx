import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { NavRail } from "#/components/nav-rail";
import type { ViewMode } from "#/lib/view-mode";

export const Route = createFileRoute("/")({ component: Planner });

function Planner() {
	const [viewMode, setViewMode] = useState<ViewMode>("3d");

	return (
		<div className="flex h-screen w-screen overflow-hidden">
			<NavRail activeMode={viewMode} onSelectMode={setViewMode} />
			<div className="workspace-canvas flex-1" data-view-mode={viewMode} />
		</div>
	);
}
