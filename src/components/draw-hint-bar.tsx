/**
 * Bottom-center helper hint bar for draw mode (mockup screen 1c): what a
 * click does plus the ⏎ / esc keys, in a dark navy pill. Editing an existing
 * outline (a closed draft) swaps the copy to the reshaping gestures.
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
		<span className="whitespace-nowrap text-[13.5px] text-[#C7D4EE]">
			{children}
		</span>
	);
}

const DIVIDER = <span className="text-white/25">·</span>;

export function DrawHintBar({ editing = false }: { editing?: boolean }) {
	return (
		<div className="-translate-x-1/2 absolute bottom-11 left-1/2 flex items-center gap-2.5 rounded-full bg-[rgba(13,22,48,0.88)] px-[18px] py-[9px] shadow-[0_14px_34px_rgba(13,22,48,0.3)]">
			{editing ? (
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
