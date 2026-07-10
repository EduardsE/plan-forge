import { Search, X } from "lucide-react";
import { useState } from "react";
import { CatalogThumbnail } from "#/components/catalog-thumbnails";
import {
	CATALOG,
	CATALOG_CATEGORY_LABELS,
	type CatalogCategory,
	type CatalogItem,
	filterCatalog,
	formatSizeCm,
} from "#/lib/model";
import { cn } from "#/lib/utils";

/**
 * The objects panel (mockup screen 1d): searchable, category-filtered
 * furniture catalog whose cards drag out onto the canvas. Every color,
 * radius and shadow is lifted from the mockup's panel markup.
 *
 * Dragging is pointer-based, not HTML5 drag-and-drop: pointerdown on a card
 * starts a placement session owned by the route (the card flips to its
 * "placing…" state via `placingId`); the drag layer and the in-scene ghost
 * take it from there.
 */

export interface ObjectsPanelProps {
	/** Catalog id mid-placement, if any — that card renders as "placing…". */
	placingId: string | null;
	onStartPlacing: (item: CatalogItem, origin: { x: number; y: number }) => void;
	onClose: () => void;
}

/** Chip order, straight from the mockup's two chip rows. */
const CHIP_ORDER: CatalogCategory[] = [
	"seating",
	"tables",
	"storage",
	"beds",
	"lighting",
	"decor",
	"wall-items",
	"plants",
];

export function ObjectsPanel({
	placingId,
	onStartPlacing,
	onClose,
}: ObjectsPanelProps) {
	const [query, setQuery] = useState("");
	// The mockup opens on Seating; clicking the active chip again shows all.
	const [category, setCategory] = useState<CatalogCategory | null>("seating");
	const items = filterCatalog(query, category);

	return (
		<div
			className="absolute inset-y-6 left-6 flex w-[340px] animate-panel-in flex-col gap-4 rounded-[20px] p-6"
			style={{
				background: "rgba(255, 255, 255, 0.84)",
				backdropFilter: "blur(20px)",
				border: "1px solid rgba(15, 27, 61, 0.08)",
				boxShadow: "0 30px 80px rgba(15, 27, 61, 0.16)",
			}}
		>
			<div className="flex items-center justify-between">
				<span className="font-bold text-[21px] text-[#0F1B3D]">Objects</span>
				<button
					type="button"
					aria-label="Close objects panel"
					onClick={onClose}
					className="cursor-pointer text-[#6B7A99]"
				>
					<X width={20} height={20} strokeWidth={1.7} />
				</button>
			</div>

			<label className="flex items-center gap-[9px] rounded-xl bg-[#EEF2F7] px-3.5 py-[11px]">
				<Search
					width={17}
					height={17}
					strokeWidth={1.7}
					className="shrink-0 text-[#8A97B1]"
				/>
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={`Search ${CATALOG.length} items`}
					className="w-full bg-transparent text-[13.5px] text-[#0F1B3D] outline-none placeholder:text-[#8A97B1]"
				/>
			</label>

			<div className="flex flex-wrap gap-[7px]">
				{CHIP_ORDER.map((chip) => {
					const active = category === chip;
					return (
						<button
							key={chip}
							type="button"
							aria-pressed={active}
							onClick={() => setCategory(active ? null : chip)}
							className={cn(
								"cursor-pointer rounded-full px-[13px] py-1.5 text-[12.5px]",
								active
									? "font-semibold text-white shadow-[0_3px_12px_rgba(20,184,166,0.4)]"
									: "border border-[rgba(15,27,61,0.10)] bg-white text-[#33415C]",
							)}
							style={
								active
									? { background: "linear-gradient(135deg, #22D3EE, #14B8A6)" }
									: undefined
							}
						>
							{CATALOG_CATEGORY_LABELS[chip]}
						</button>
					);
				})}
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto">
				{items.map((item) =>
					item.id === placingId ? (
						<div
							key={item.id}
							className="flex flex-col rounded-[14px] border-2 border-dashed border-[rgba(34,211,238,0.55)] bg-[rgba(34,211,238,0.05)] p-[9px]"
						>
							<div className="flex h-[92px] items-center justify-center">
								<span className="font-mono text-[11.5px] text-[#0F766E]">
									placing…
								</span>
							</div>
							<div className="mt-[9px] font-semibold text-[13.5px] text-[#8A97B1]">
								{item.name}
							</div>
							<div className="font-mono text-[11px] text-[#B6C2D9]">
								{formatSizeCm(item.footprint)}
							</div>
						</div>
					) : (
						<button
							key={item.id}
							type="button"
							onPointerDown={(event) => {
								// Left button / primary touch only; keep the browser from
								// starting text selection under the drag.
								if (!event.isPrimary || event.button !== 0) return;
								event.preventDefault();
								onStartPlacing(item, { x: event.clientX, y: event.clientY });
							}}
							className="cursor-grab rounded-[14px] border border-[rgba(15,27,61,0.06)] bg-white p-2.5 text-left shadow-[0_6px_18px_rgba(15,27,61,0.06)]"
						>
							<CatalogThumbnail catalogId={item.id} />
							<div className="mt-[9px] font-semibold text-[13.5px] text-[#22304F]">
								{item.name}
							</div>
							<div className="font-mono text-[11px] text-[#8A97B1]">
								{formatSizeCm(item.footprint)}
							</div>
						</button>
					),
				)}
				{items.length === 0 && (
					<div className="col-span-2 py-8 text-center text-[13px] text-[#8A97B1]">
						No items match your search.
					</div>
				)}
			</div>

			<div className="rounded-xl border border-[rgba(34,211,238,0.3)] bg-[rgba(34,211,238,0.08)] px-3.5 py-[11px] text-[12.5px] text-[#0F766E] leading-[1.45]">
				Drag an item onto the floor — it snaps to walls and other objects.
			</div>
		</div>
	);
}
