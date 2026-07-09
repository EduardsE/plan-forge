import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ViewMode } from "#/lib/view-mode";

export const Route = createFileRoute("/")({ component: Planner });

function Planner() {
	const [viewMode] = useState<ViewMode>("3d");

	return <div className="workspace-canvas" data-view-mode={viewMode} />;
}
