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
 * The objects library (screen 2d): a 306px column docked between the rail
 * and the canvas — searchable, category-filtered furniture catalog whose
 * cards drag out onto the floor. Paper chrome: panel surface, hairline
 * seams, white cards, solid-blue active chip.
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

/** Chip order, straight from the mockup's chip rows. */
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
      className="flex min-h-0 flex-col border-[var(--hairline)] border-r bg-[var(--panel)]"
      style={{ gridArea: "library" }}
    >
      <div className="flex items-center justify-between px-[18px] pt-4 pb-3">
        <div className="flex items-center gap-[9px]">
          <span className="font-bold text-[17px] text-[var(--ink-900)]">
            Objects
          </span>
          <span className="rounded-[6px] bg-[#edede9] px-2 py-[2px] font-mono text-[11px] text-[var(--ink-500)]">
            {CATALOG.length}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close objects panel"
          onClick={onClose}
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] border border-[var(--control-border)] text-[var(--ink-500)] hover:bg-[var(--well)]"
        >
          <X width={14} height={14} strokeWidth={1.7} />
        </button>
      </div>

      <div className="px-[18px] pb-3">
        <label className="flex items-center gap-[9px] rounded-[9px] border border-[var(--control-border)] bg-[var(--well)] px-3 py-[9px]">
          <Search
            width={16}
            height={16}
            strokeWidth={1.7}
            className="shrink-0 text-[var(--ink-400)]"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${CATALOG.length} items`}
            className="w-full bg-transparent text-[13px] text-[var(--ink-900)] outline-none placeholder:text-[var(--ink-400)]"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5 px-[18px] pb-3.5">
        {CHIP_ORDER.map((chip) => {
          const active = category === chip;
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(active ? null : chip)}
              className={cn(
                "cursor-pointer rounded-[7px] px-3 py-[5px] text-[12px]",
                active
                  ? "bg-[var(--blue)] font-semibold text-white"
                  : "border border-[var(--control-border)] bg-[var(--frame)] text-[var(--ink-600)] hover:bg-[var(--well)]",
              )}
            >
              {CATALOG_CATEGORY_LABELS[chip]}
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto px-[18px]">
        {items.map((item) =>
          item.id === placingId ? (
            <div
              key={item.id}
              className="flex flex-col rounded-[12px] border-[1.5px] border-dashed border-[rgba(58,91,240,0.55)] bg-[rgba(58,91,240,0.05)] p-2.5"
            >
              <div className="flex h-[82px] items-center justify-center">
                <span className="font-mono text-[11px] text-[var(--blue)]">
                  placing…
                </span>
              </div>
              <div className="mt-[9px] font-semibold text-[13px] text-[var(--ink-400)]">
                {item.name}
              </div>
              <div className="mt-px font-mono text-[11px] text-[var(--ink-300)]">
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
              className="cursor-grab rounded-[12px] border border-[var(--control-border)] bg-[var(--frame)] p-2.5 text-left"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <CatalogThumbnail catalogId={item.id} className="h-[82px]" />
              <div className="mt-[9px] font-semibold text-[13px] text-[var(--ink-900)]">
                {item.name}
              </div>
              <div className="mt-px font-mono text-[11px] text-[var(--ink-400)]">
                {formatSizeCm(item.footprint)}
              </div>
            </button>
          ),
        )}
        {items.length === 0 && (
          <div className="col-span-2 py-8 text-center text-[13px] text-[var(--ink-400)]">
            No items match your search.
          </div>
        )}
      </div>

      <div className="mt-2 border-[var(--hairline)] border-t px-[18px] py-3.5 text-[12px] text-[var(--ink-500)] leading-[1.45]">
        Drag an item onto the floor — it snaps to walls and other objects.
      </div>
    </div>
  );
}
