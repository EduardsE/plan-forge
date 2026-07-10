import type { ComponentProps, JSX } from "react";
import { cn } from "#/lib/utils";

export type DrawTool = "select" | "wall" | "rect";

/**
 * The vertical draw tool stack (mockup screen 1c), floating under the main
 * toolbar. Select stops corner placement (and, over an existing room, is the
 * reshaping mode); wall places outline corners click-by-click; rect draws a
 * rectangular room from two opposite-corner clicks. (The mockup's arc-wall and
 * split-wall stubs were dropped — arcs aren't in the straight-segment wall
 * model, and wall splitting already lives in the reshaping flow.)
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
	icon: JSX.Element;
}

const TOOLS: ToolDef[] = [
	{
		tool: "select",
		label: "Select",
		icon: (
			<IconSvg>
				<path d="M5 3l4.5 12 1.8-4.7L16 8.5 5 3z" />
			</IconSvg>
		),
	},
	{
		tool: "wall",
		label: "Draw walls",
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
		icon: (
			<IconSvg>
				<rect x="3.5" y="5" width="13" height="10" rx="1" />
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
			{TOOLS.map(({ tool: id, label, icon }) => {
				const isActive = id === tool;
				return (
					<button
						key={id}
						type="button"
						aria-label={label}
						aria-pressed={isActive}
						onClick={() => onToolChange(id)}
						className={cn(
							"flex h-10 w-10 items-center justify-center rounded-[10px]",
							isActive
								? "bg-[rgba(45,212,207,0.16)] text-[#0F766E] shadow-[0_0_0_1px_rgba(34,211,238,0.4)]"
								: "text-[var(--navy-500)] hover:bg-[var(--surface-alt)]",
						)}
					>
						{icon}
					</button>
				);
			})}
		</div>
	);
}
