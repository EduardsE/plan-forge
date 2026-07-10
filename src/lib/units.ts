/**
 * Display units for lengths. The model is always meters (see
 * `src/lib/model/types.ts`); the cm/m toggle only changes how labels render
 * and how typed lengths are read back.
 */

export type Unit = "cm" | "m";

/** A model length in meters rendered for the active unit: "6.40 m" / "640 cm". */
export function formatLength(meters: number, unit: Unit): string {
	if (unit === "cm") return `${Math.round(meters * 100)} cm`;
	return `${meters.toFixed(2)} m`;
}

/** Like `formatLength` but without the unit suffix (for the inline input). */
export function formatLengthValue(meters: number, unit: Unit): string {
	if (unit === "cm") return String(Math.round(meters * 100));
	return meters.toFixed(2);
}

/**
 * Parse a typed length in the active unit back to meters. Accepts a decimal
 * comma; returns null for anything non-finite or not strictly positive.
 */
export function parseLength(input: string, unit: Unit): number | null {
	const value = Number(input.trim().replace(",", "."));
	if (!Number.isFinite(value) || value <= 0) return null;
	return unit === "cm" ? value / 100 : value;
}
