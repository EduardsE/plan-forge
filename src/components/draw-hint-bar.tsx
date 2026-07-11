/**
 * Bottom-center helper hint bar for draw mode (mockup screen 1c): what a
 * click does plus the ⏎ / esc keys, in a dark ink pill (the one dark element on the Paper canvas, like the tooltips). The rect tool swaps
 * the copy to its two-click gesture; otherwise editing an existing outline (a
 * closed draft) shows the reshaping gestures, and fresh drawing the placement
 * ones.
 */

function Key({ children }: { children: string }) {
	return (
		<span className="rounded-[5px] bg-white/10 px-[7px] py-px font-mono text-[12px]">
			{children}
		</span>
	);
}

function Hint({ children }: { children: React.ReactNode }) {
	return (
		<span className="whitespace-nowrap text-[13px] text-[#d7d7d2]">
			{children}
		</span>
	);
}

const DIVIDER = <span className="text-white/25">·</span>;

export function DrawHintBar({
	editing = false,
	rect = false,
}: {
	editing?: boolean;
	rect?: boolean;
}) {
	return (
		<div className="-translate-x-1/2 absolute bottom-11 left-1/2 flex items-center gap-2.5 rounded-[9px] bg-[var(--ink-900)] px-4 py-2 shadow-[0_14px_34px_rgba(15,27,61,0.25)]">
			{rect ? (
				<>
					<Hint>Click two opposite corners</Hint>
					{DIVIDER}
					<Hint>
						<Key>esc</Key> cancel
					</Hint>
				</>
			) : editing ? (
				<>
					<Hint>Drag corners to reshape</Hint>
					{DIVIDER}
					<Hint>Click a wall to add a corner</Hint>
					{DIVIDER}
					<Hint>
						<Key>⏎</Key> apply
					</Hint>
					{DIVIDER}
					<Hint>
						<Key>esc</Key> revert
					</Hint>
				</>
			) : (
				<>
					<Hint>Click to place corner</Hint>
					{DIVIDER}
					<Hint>
						<Key>⏎</Key> close room
					</Hint>
					{DIVIDER}
					<Hint>
						<Key>esc</Key> cancel
					</Hint>
				</>
			)}
		</div>
	);
}
