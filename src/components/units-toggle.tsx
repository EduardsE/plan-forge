import type { Unit } from "#/lib/units";
import { cn } from "#/lib/utils";

const UNITS: Unit[] = ["cm", "m"];

interface UnitsToggleProps {
	unit: Unit;
	onUnitChange: (unit: Unit) => void;
}

/**
 * Top-right cm/m units toggle, matching the mockup's screen 1c (draw mode)
 * only — grepping `design/planforge-mockups.html` for "Units" turns up a
 * single hit, on that screen, so it isn't rendered elsewhere.
 *
 * Controlled: the route owns the unit so draw-mode labels and readouts render
 * in the selected unit.
 */
export function UnitsToggle({ unit, onUnitChange }: UnitsToggleProps) {
	return (
		<div className="absolute right-10 top-9 flex items-center gap-2.5">
			<span className="text-[13px] text-[var(--navy-300)]">Units</span>
			<div
				className="flex rounded-full p-1"
				style={{
					background: "var(--surface-glass)",
					border: "1px solid var(--border-subtle)",
					boxShadow: "var(--shadow-md)",
					backdropFilter: "blur(16px)",
				}}
			>
				{UNITS.map((option) => {
					const isActive = option === unit;
					return (
						<button
							key={option}
							type="button"
							aria-pressed={isActive}
							onClick={() => onUnitChange(option)}
							className={cn(
								"rounded-full px-4 py-1.5 text-[13.5px] font-semibold",
								isActive ? "text-white" : "text-[var(--navy-500)]",
							)}
							style={
								isActive
									? {
											background:
												"linear-gradient(135deg, var(--accent-cyan), var(--accent-teal))",
											boxShadow: "0 4px 14px rgba(20, 184, 166, 0.5)",
										}
									: undefined
							}
						>
							{option}
						</button>
					);
				})}
			</div>
		</div>
	);
}
