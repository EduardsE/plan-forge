import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({ component: Planner });

export type ViewMode = "3d" | "2d" | "draw" | "objects";

function Planner() {
	const [viewMode] = useState<ViewMode>("3d");

	return <div className="workspace-canvas" data-view-mode={viewMode} />;
}
