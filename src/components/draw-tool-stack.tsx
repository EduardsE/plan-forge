import type { ComponentProps, JSX } from "react";
import { cn } from "#/lib/utils";

export type DrawTool = "select" | "wall" | "rect" | "polygon" | "split";

/**
 * The vertical draw tool stack (mockup screen 1c), floating under the main
 * toolbar. Select and wall are live tools; rect / polygon / split are Phase 4
 * stubs (rendered enabled-looking per the mockup, but inert).
 *
 * The icons are the mockup's inline SVGs verbatim — none of them has a close
 * lucide equivalent (e.g. the wall tool's line-with-endpoint-dots).
 */

function IconSvg(props: ComponentProps<"svg">) {
	return (
		<svg
			width={19}
			height={19}
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.6}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		/>
	);
}

interface ToolDef {
	tool: DrawTool;
	label: string;
	live: boolean;
	icon: JSX.Element;
}

const TOOLS: ToolDef[] = [
	{
		tool: "select",
		label: "Select",
		live: true,
		icon: (
			<IconSvg>
				<path d="M5 3l4.5 12 1.8-4.7L16 8.5 5 3z" />
			</IconSvg>
		),
	},
	{
		tool: "wall",
		label: "Draw walls",
		live: true,
		icon: (
			<IconSvg>
				<path d="M5 15L15 5" />
				<circle cx="5" cy="15" r="1.8" />
				<circle cx="15" cy="5" r="1.8" />
			</IconSvg>
		),
	},
	{
		tool: "rect",
		label: "Rectangle room",
		live: false,
		icon: (
			<IconSvg>
				<rect x="3.5" y="5" width="13" height="10" rx="1" />
			</IconSvg>
		),
	},
	{
		tool: "polygon",
		label: "Arc wall",
		live: false,
		icon: (
			<IconSvg>
				<path d="M6 16V4h8" />
				<path d="M14 4a10 10 0 0 1-8 12" />
			</IconSvg>
		),
	},
	{
		tool: "split",
		label: "Split wall",
		live: false,
		icon: (
			<IconSvg>
				<rect x="4" y="4" width="12" height="12" rx="1" />
				<path d="M10 4v12" />
			</IconSvg>
		),
	},
];

interface DrawToolStackProps {
	tool: DrawTool;
	onToolChange: (tool: DrawTool) => void;
}

export function DrawToolStack({ tool, onToolChange }: DrawToolStackProps) {
	return (
		<div
			className="absolute left-10 top-[196px] flex flex-col gap-1 rounded-2xl p-1.5"
			style={{
				background: "var(--surface-glass)",
				border: "1px solid var(--border-subtle)",
				boxShadow: "var(--shadow-md)",
				backdropFilter: "blur(16px)",
			}}
		>
			{TOOLS.map(({ tool: id, label, live, icon }) => {
				const isActive = id === tool;
				return (
					<button
						key={id}
						type="button"
						aria-label={label}
						aria-pressed={isActive}
						onClick={live ? () => onToolChange(id) : undefined}
						className={cn(
							"flex h-10 w-10 items-center justify-center rounded-[10px]",
							isActive
								? "bg-[rgba(45,212,207,0.16)] text-[#0F766E] shadow-[0_0_0_1px_rgba(34,211,238,0.4)]"
								: "text-[var(--navy-500)]",
							live && !isActive && "hover:bg-[var(--surface-alt)]",
						)}
					>
						{icon}
					</button>
				);
			})}
		</div>
	);
}
