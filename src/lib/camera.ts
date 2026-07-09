/**
 * Camera math and readout plumbing shared between the R3F camera rig and the
 * DOM chrome (floating toolbar, bottom-right readout chip). Everything here
 * is renderer-agnostic: world lengths in meters, screen lengths in CSS px.
 */

/** Live state of the orbiting perspective camera (3D lens). */
export interface OrbitReadout {
	kind: "orbit";
	/** Horizontal orbit angle in degrees. */
	azimuthDeg: number;
	/** Angle from straight-above in degrees (0 = top-down). */
	polarDeg: number;
	/** Zoom relative to the fitted distance: 1.0 = fit-to-view. */
	zoom: number;
}

/** Live state of the top-down orthographic camera (2D/draw lens). */
export interface PlanReadout {
	kind: "plan";
	/** Orthographic zoom: how many CSS px one meter spans on screen. */
	pxPerMeter: number;
}

export type CameraReadout = OrbitReadout | PlanReadout;

/** Imperative camera actions the floating toolbar drives. */
export interface CameraApi {
	zoomIn(): void;
	zoomOut(): void;
	zoomToFit(): void;
}

const CSS_PX_PER_CM = 96 / 2.54;

/**
 * Paper-scale denominator N (as in "scale 1 : N") for a plan rendered at
 * pxPerMeter, treating CSS px at their nominal 96 dpi physical size.
 */
export function scaleDenominator(pxPerMeter: number): number {
	return Math.round((100 * CSS_PX_PER_CM) / pxPerMeter);
}

export function formatOrbitReadout(readout: OrbitReadout): string {
	const azimuth = ((Math.round(readout.azimuthDeg) % 360) + 360) % 360;
	const polar = Math.round(readout.polarDeg);
	return `orbit ${azimuth}° / ${polar}° · zoom ${readout.zoom.toFixed(1)}×`;
}

export function formatPlanReadout(
	readout: PlanReadout,
	gridMeters = 0.5,
): string {
	return `scale 1 : ${scaleDenominator(readout.pxPerMeter)} · grid ${gridMeters} m`;
}

/**
 * Orthographic zoom (CSS px per meter) that fits a widthM × heightM extent
 * into the viewport, filling at most `fill` of the smaller direction.
 */
export function planFitZoom(
	widthM: number,
	heightM: number,
	viewportW: number,
	viewportH: number,
	fill = 0.72,
): number {
	return Math.min(viewportW / widthM, viewportH / heightM) * fill;
}

/**
 * Distance at which a perspective camera (vertical fov fovYDeg, viewport
 * aspect w/h) fits a bounding sphere of the given radius, with `margin`
 * extra breathing room (1 = sphere exactly touches the frustum).
 */
export function perspectiveFitDistance(
	radius: number,
	fovYDeg: number,
	aspect: number,
	margin = 1.15,
): number {
	const halfV = (fovYDeg * Math.PI) / 360;
	const halfH = Math.atan(Math.tan(halfV) * aspect);
	return (radius * margin) / Math.sin(Math.min(halfV, halfH));
}

/**
 * Tiny external store connecting the rig (publisher, inside the R3F canvas)
 * to the readout chip (subscriber via useSyncExternalStore) without routing
 * per-frame camera state through route-level React state.
 */
export interface CameraReadoutStore {
	subscribe(listener: () => void): () => void;
	getSnapshot(): CameraReadout | null;
	publish(readout: CameraReadout): void;
}

export function createCameraReadoutStore(): CameraReadoutStore {
	let snapshot: CameraReadout | null = null;
	const listeners = new Set<() => void>();
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => snapshot,
		publish(readout) {
			snapshot = readout;
			for (const listener of listeners) listener();
		},
	};
}
