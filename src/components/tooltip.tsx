import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipProps {
	/** The pill text — pass the trigger's existing aria-label so the two can't
	 * drift (this component never sets aria itself; the button keeps that). */
	label: string;
	/** Which edge of the trigger the pill hangs off. */
	side?: TooltipSide;
	children: ReactNode;
}

const SIDE_CLASS: Record<TooltipSide, string> = {
	top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
	bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
	left: "right-full top-1/2 mr-2 -translate-y-1/2",
	right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

/**
 * A lightweight hover/focus tooltip: a small navy pill matching the chrome,
 * driven entirely by CSS group state so it needs no portal — which is why the
 * same component works inside the drei `<Html>` selection chips, where a Radix
 * portal can't reach. Wrap an icon-only button and pass its aria-label; the
 * trigger keeps the aria-label, this just shows it on hover.
 */
export function Tooltip({ label, side = "top", children }: TooltipProps) {
	return (
		<span className="group/tt relative inline-flex">
			{children}
			<span
				role="tooltip"
				className={cn(
					"pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1 font-medium text-[11px] text-[var(--navy-50)] opacity-0 shadow-[0_8px_20px_rgba(12,20,48,0.35)] transition-opacity duration-100",
					"group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
					SIDE_CLASS[side],
				)}
				style={{
					background: "var(--navy-900)",
					border: "1px solid rgba(94, 234, 212, 0.22)",
				}}
			>
				{label}
			</span>
		</span>
	);
}
