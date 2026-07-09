import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Planner });

function Planner() {
	return <div className="workspace-canvas" />;
}
