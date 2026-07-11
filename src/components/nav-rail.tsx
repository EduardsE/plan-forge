import { Box, Eye, Pencil, SlidersHorizontal, Sofa } from "lucide-react";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

interface NavRailProps {
	activeMode: ViewMode;
	onSelectMode: (mode: ViewMode) => void;
}

interface NavItemDef {
	label: string;
	icon: typeof Pencil;
	mode: ViewMode | null;
}

const NAV_ITEMS: NavItemDef[] = [
	{ label: "Draw", icon: Pencil, mode: "draw" },
	{ label: "Furnish", icon: Sofa, mode: "3d" },
	{ label: "Objects", icon: Box, mode: "objects" },
	{ label: "Views", icon: Eye, mode: "2d" },
	{ label: "Settings", icon: SlidersHorizontal, mode: null },
];

export function NavRail({ activeMode, onSelectMode }: NavRailProps) {
	return (
		<nav
			aria-label="Primary"
			className="flex w-24 flex-col items-center gap-2 bg-sidebar py-[22px]"
			style={{ boxShadow: "var(--shadow-rail)" }}
		>
			<div
				className="mb-4 flex h-11 w-11 items-center justify-center rounded-[13px]"
				style={{
					background:
						"linear-gradient(135deg, var(--accent-from), var(--accent-to))",
					boxShadow: "var(--shadow-glow-accent)",
				}}
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 20 20"
					fill="none"
					stroke="var(--accent-ink)"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2L10 2.5z" />
					<path d="M3.5 6.2L10 10l6.5-3.8M10 10v7.5" />
				</svg>
			</div>

			{NAV_ITEMS.map(({ label, icon: Icon, mode }) => {
				const isActive = mode !== null && mode === activeMode;
				return (
					<button
						key={label}
						type="button"
						aria-current={isActive ? "page" : undefined}
						onClick={mode === null ? undefined : () => onSelectMode(mode)}
						style={
							isActive
								? { boxShadow: "var(--shadow-glow-nav-active)" }
								: undefined
						}
						className={cn(
							"flex w-[78px] flex-col items-center gap-1.5 rounded-xl py-[11px] text-[10px] tracking-wide text-sidebar-foreground",
							isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
							label === "Settings" && "mt-auto",
						)}
					>
						<Icon width={22} height={22} strokeWidth={1.5} />
						<span>{label}</span>
					</button>
				);
			})}

			<div
				className="mt-3 h-[38px] w-[38px] rounded-full"
				style={{
					background: "linear-gradient(135deg, #e8b48a, #b4633e)",
					boxShadow: "0 0 0 2px rgba(126, 147, 190, 0.35)",
				}}
			/>
		</nav>
	);
}
