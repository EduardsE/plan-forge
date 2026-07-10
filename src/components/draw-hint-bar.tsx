/**
 * Bottom-center helper hint bar for draw mode (mockup screen 1c): what a
 * click does plus the ⏎ / esc keys, in a dark navy pill.
 */

function Key({ children }: { children: string }) {
	return (
		<span className="rounded-[5px] bg-white/10 px-[7px] py-px font-mono text-[12px]">
			{children}
		</span>
	);
}

export function DrawHintBar() {
	return (
		<div className="-translate-x-1/2 absolute bottom-11 left-1/2 flex items-center gap-2.5 rounded-full bg-[rgba(13,22,48,0.88)] px-[18px] py-[9px] shadow-[0_14px_34px_rgba(13,22,48,0.3)]">
			<span className="whitespace-nowrap text-[13.5px] text-[#C7D4EE]">
				Click to place corner
			</span>
			<span className="text-white/25">·</span>
			<span className="whitespace-nowrap text-[13.5px] text-[#C7D4EE]">
				<Key>⏎</Key> close room
			</span>
			<span className="text-white/25">·</span>
			<span className="whitespace-nowrap text-[13.5px] text-[#C7D4EE]">
				<Key>esc</Key> cancel
			</span>
		</div>
	);
}
