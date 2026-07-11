import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Footprint, FurnitureItem } from "#/lib/model";
import { furnitureDisplayName } from "#/lib/model";
import { WALL_HEIGHT } from "#/lib/room-scene";
import { formatLengthValue, parseLength, type Unit } from "#/lib/units";

/**
 * The selected-item properties card, docked at the workspace's top-right edge
 * (a DOM overlay, not an in-scene chip — it holds text inputs). Numeric
 * W × D × H fields in the active display unit, plus an exact rotation-degrees
 * field — or, for wall-mounted items whose rotation is derived from the wall,
 * the mount's center elevation instead.
 *
 * Each field commits on blur/⏎ (one history step per commit, never per
 * keystroke); esc reverts the field. Invalid or no-op input snaps back to the
 * canonical value.
 */

/** Below this, two lengths (meters) or angles (deg) count as the same value. */
const SAME_EPSILON = 1e-9;

interface FieldProps {
	label: string;
	ariaLabel: string;
	/** Unit hint rendered inside the field's right edge. */
	suffix: string;
	/** Canonical formatted value; the field re-seeds from it when it changes. */
	value: string;
	/** Parse + apply the typed text; invalid input is the parser's to drop. */
	onCommit: (text: string) => void;
}

function Field({ label, ariaLabel, suffix, value, onCommit }: FieldProps) {
	const [text, setText] = useState(value);
	// Escape sets this so the blur it triggers reverts instead of committing.
	const cancelledRef = useRef(false);
	// External changes (a drag, the rotate button, containment) re-seed the
	// field; it is never focused then, since those gestures blur it first.
	useEffect(() => setText(value), [value]);

	const handleBlur = () => {
		if (!cancelledRef.current && text !== value) onCommit(text);
		cancelledRef.current = false;
		// Snap back to canonical: a successful commit re-seeds via the effect,
		// an invalid or clamped-to-same one lands right here.
		setText(value);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
		} else if (event.key === "Escape") {
			cancelledRef.current = true;
			setText(value);
			event.currentTarget.blur();
		}
	};

	return (
		<label className="flex min-w-0 flex-col gap-1">
			<span className="font-mono text-[10px] text-[var(--navy-300)] uppercase tracking-[0.08em]">
				{label}
			</span>
			<div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-white/70 focus-within:border-[rgba(34,211,238,0.5)] focus-within:shadow-[0_0_0_1px_rgba(34,211,238,0.35)]">
				<input
					type="text"
					inputMode="decimal"
					aria-label={ariaLabel}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onFocus={(event) => event.currentTarget.select()}
					onBlur={handleBlur}
					onKeyDown={handleKeyDown}
					className="w-full min-w-0 bg-transparent px-1.5 py-1.5 font-mono text-[12px] text-[var(--navy-900)] outline-none"
				/>
				<span className="pr-2 font-mono text-[10px] text-[var(--navy-300)]">
					{suffix}
				</span>
			</div>
		</label>
	);
}

/** Degrees for display: at most one decimal, no trailing zeros ("45", "22.5"). */
function formatDegrees(deg: number): string {
	return String(Math.round(deg * 10) / 10);
}

interface PropertiesCardProps {
	item: FurnitureItem;
	unit: Unit;
	/** A committed size edit — the full footprint with one dimension changed. */
	onResize: (footprint: Footprint) => void;
	/** A committed exact angle, degrees CCW (floor items only). */
	onRotateTo: (deg: number) => void;
	/** A committed mount center elevation, meters (wall items only). */
	onElevate: (elevation: number) => void;
}

export function PropertiesCard({
	item,
	unit,
	onResize,
	onRotateTo,
	onElevate,
}: PropertiesCardProps) {
	const commitSize = (dimension: keyof Footprint) => (text: string) => {
		const meters = parseLength(text, unit);
		if (meters === null) return;
		if (Math.abs(meters - item.footprint[dimension]) < SAME_EPSILON) return;
		onResize({ ...item.footprint, [dimension]: meters });
	};
	const commitRotation = (text: string) => {
		const deg = Number(text.trim().replace(",", "."));
		if (!Number.isFinite(deg)) return;
		const normalized = ((deg % 360) + 360) % 360;
		if (Math.abs(normalized - item.rotation) < SAME_EPSILON) return;
		onRotateTo(normalized);
	};
	const commitElevation = (text: string) => {
		const mount = item.mount;
		if (!mount) return;
		const meters = parseLength(text, unit);
		if (meters === null) return;
		// Keep the body between floor and ceiling; the floor clamp also lives
		// in the model, the wall height only the renderer knows.
		const half = item.footprint.height / 2;
		const clamped = Math.min(Math.max(meters, half), WALL_HEIGHT - half);
		if (Math.abs(clamped - mount.elevation) < SAME_EPSILON) return;
		onElevate(clamped);
	};

	const lengthField = (
		label: string,
		ariaLabel: string,
		meters: number,
		onCommit: (text: string) => void,
	) => (
		<Field
			label={label}
			ariaLabel={ariaLabel}
			suffix={unit}
			value={formatLengthValue(meters, unit)}
			onCommit={onCommit}
		/>
	);

	return (
		<div
			className="absolute top-9 right-10 w-[248px] rounded-2xl p-4"
			style={{
				background: "var(--surface-glass)",
				border: "1px solid var(--border-subtle)",
				boxShadow: "var(--shadow-md)",
				backdropFilter: "blur(16px)",
				// Docked chrome paints above the in-scene selection chips (drei
				// <Html> hard-codes z-index 16777271 on its overlays).
				zIndex: 16777272,
			}}
			data-testid="properties-card"
		>
			<div className="font-mono text-[10.5px] text-[var(--navy-300)] uppercase tracking-[0.14em]">
				Selection
			</div>
			<div className="mt-0.5 truncate font-semibold text-[13.5px] text-[var(--navy-900)]">
				{furnitureDisplayName(item.catalogId)}
			</div>
			<div className="mt-3 grid grid-cols-3 gap-1.5">
				{lengthField("W", "Width", item.footprint.width, commitSize("width"))}
				{lengthField("D", "Depth", item.footprint.depth, commitSize("depth"))}
				{lengthField(
					"H",
					"Height",
					item.footprint.height,
					commitSize("height"),
				)}
			</div>
			<div className="mt-3 grid grid-cols-3 gap-1.5">
				{item.mount ? (
					<div className="col-span-2">
						{lengthField(
							"Elevation",
							"Elevation",
							item.mount.elevation,
							commitElevation,
						)}
					</div>
				) : (
					<Field
						label="Rotation"
						ariaLabel="Rotation"
						suffix="°"
						value={formatDegrees(item.rotation)}
						onCommit={commitRotation}
					/>
				)}
			</div>
		</div>
	);
}
