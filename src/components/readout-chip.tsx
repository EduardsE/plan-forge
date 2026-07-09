import type { ViewMode } from "#/lib/view-mode";

interface ReadoutChipProps {
	mode: ViewMode;
}

/** Contextual readout text, verbatim from the mockup's bottom-right chip per screen. */
const READOUT_BY_MODE: Record<ViewMode, string> = {
	"3d": "orbit 38° / 62° · zoom 1.0×",
	"2d": "scale 1 : 50 · grid 0.5 m",
	draw: "snap 90° · grid 0.5 m",
	objects: "snap · walls + objects",
};

/**
 * Bottom-right contextual readout chip, matching the mockup's screens 1a–1d
 * (byte-identical markup across all four — only the text content changes):
 * camera orbit/zoom in 3D, plan scale/grid in 2D, snap angle/grid while
 * drawing, and active snap targets while placing objects.
 *
 * Static Phase 1 chrome — the numbers are copied from the mockup, not live.
 */
export function ReadoutChip({ mode }: ReadoutChipProps) {
	return (
		<div
			className="absolute right-10 bottom-12 rounded-[10px] px-3.5 py-2 font-mono text-[12px] text-[var(--navy-400)]"
			style={{
				background: "var(--surface-glass)",
				border: "1px solid var(--border-subtle)",
				boxShadow: "var(--shadow-md)",
				backdropFilter: "blur(12px)",
			}}
		>
			{READOUT_BY_MODE[mode]}
		</div>
	);
}
