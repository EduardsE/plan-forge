import { ArrowLeftRight, Copy, DoorOpen, RotateCw, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { CatalogThumbnail } from "#/components/catalog-thumbnails";
import { colorwaysForCatalog, furnitureBaseColor } from "#/lib/furniture-parts";
import {
  CATALOG_CATEGORY_LABELS,
  catalogItemById,
  type Footprint,
  type FurnitureItem,
  floorArea,
  furnitureDisplayName,
  type Opening,
  type Point,
  type Room,
  totalFloorArea,
  totalPerimeter,
  wallHeightOf,
} from "#/lib/model";
import { formatLengthValue, parseLength, type Unit } from "#/lib/units";
import { cn } from "#/lib/utils";
import type { ViewMode } from "#/lib/view-mode";

/**
 * The 320px inspector column (screen 2b): a caps section header, then —
 * with a furniture selection — the item card, editable TRANSFORM value
 * cards (size / rotation or elevation / position), and the ARRANGE actions;
 * without one, a quiet room overview; in draw mode, the draft's state.
 * The FLOOR / PERIMETER / CEILING stats footer is always there.
 *
 * Each field commits on blur/⏎ (one history step per commit, never per
 * keystroke); esc reverts the field. Invalid or no-op input snaps back to
 * the canonical value — the commit-on-blur machinery is carried over from
 * the retired properties card.
 */

/** Below this, two lengths (meters) or angles (deg) count as the same value. */
const SAME_EPSILON = 1e-9;

interface FieldProps {
  label: string;
  ariaLabel: string;
  /** Unit hint rendered inside the field's right edge. */
  suffix: string;
  /** Canonical formatted value; the field re-seeds from it when it changes. */
  value: string;
  /** Parse + apply the typed text; invalid input is the parser's to drop. */
  onCommit: (text: string) => void;
}

/** One TRANSFORM value card: caps label over a mono editable value. */
function Field({ label, ariaLabel, suffix, value, onCommit }: FieldProps) {
  const [text, setText] = useState(value);
  // Escape sets this so the blur it triggers reverts instead of committing.
  const cancelledRef = useRef(false);
  // External changes (a drag, the rotate button, containment) re-seed the
  // field; it is never focused then, since those gestures blur it first.
  useEffect(() => setText(value), [value]);

  const handleBlur = () => {
    if (!cancelledRef.current && text !== value) onCommit(text);
    cancelledRef.current = false;
    // Snap back to canonical: a successful commit re-seeds via the effect,
    // an invalid or clamped-to-same one lands right here.
    setText(value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      cancelledRef.current = true;
      setText(value);
      event.currentTarget.blur();
    }
  };

  return (
    <label className="flex min-w-0 flex-col gap-[3px] rounded-[8px] border border-[var(--control-border)] bg-[var(--frame)] px-[11px] py-2 focus-within:border-[var(--blue)]">
      <span className="text-[10px] text-[var(--ink-400)] tracking-[0.05em]">
        {label}
      </span>
      <span className="flex items-baseline">
        <input
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-full min-w-0 bg-transparent font-mono text-[14px] text-[var(--ink-900)] outline-none"
        />
        <span className="font-mono text-[11px] text-[var(--ink-300)]">
          {suffix}
        </span>
      </span>
    </label>
  );
}

/** Degrees for display: at most one decimal, no trailing zeros ("45", "22.5"). */
function formatDegrees(deg: number): string {
  return String(Math.round(deg * 10) / 10);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-semibold text-[11px] text-[var(--ink-400)] tracking-[0.11em]">
      {children}
    </div>
  );
}

interface SelectionSectionProps {
  item: FurnitureItem;
  /** Display name of the furniture the item stands on, if stacked. */
  hostName: string | null;
  /** Containing-room name, shown on multi-room floors (else null). */
  roomName: string | null;
  /** The owning room's wall height — the ceiling clamp for elevations. */
  wallHeight: number;
  unit: Unit;
  /** A committed size edit — the full footprint with one dimension changed. */
  onResize: (footprint: Footprint) => void;
  /** A committed exact angle, degrees CCW (floor items only). */
  onRotateTo: (deg: number) => void;
  /** A committed mount center elevation, meters (wall items only). */
  onElevate: (elevation: number) => void;
  /** A committed center position, meters (floor items only). */
  onMoveTo: (position: Point) => void;
  /** A committed material colorway; null clears the override to the default. */
  onRecolor: (colorway: string | null) => void;
  onRotate90: () => void;
  onClone: () => void;
  onDelete: () => void;
}

function SelectionSection({
  item,
  hostName,
  roomName,
  wallHeight,
  unit,
  onResize,
  onRotateTo,
  onElevate,
  onMoveTo,
  onRecolor,
  onRotate90,
  onClone,
  onDelete,
}: SelectionSectionProps) {
  const catalogItem = catalogItemById(item.catalogId);
  const colorways = colorwaysForCatalog(item.catalogId);
  const baseColor = furnitureBaseColor(item.catalogId);
  const activeColor = item.colorway ?? baseColor;

  const commitSize = (dimension: keyof Footprint) => (text: string) => {
    const meters = parseLength(text, unit);
    if (meters === null) return;
    if (Math.abs(meters - item.footprint[dimension]) < SAME_EPSILON) return;
    onResize({ ...item.footprint, [dimension]: meters });
  };
  const commitRotation = (text: string) => {
    const deg = Number(text.trim().replace(",", "."));
    if (!Number.isFinite(deg)) return;
    const normalized = ((deg % 360) + 360) % 360;
    if (Math.abs(normalized - item.rotation) < SAME_EPSILON) return;
    onRotateTo(normalized);
  };
  const commitElevation = (text: string) => {
    const mount = item.mount;
    if (!mount) return;
    const meters = parseLength(text, unit);
    if (meters === null) return;
    // Keep the body between floor and ceiling; the floor clamp also lives
    // in the model, the ceiling clamp is this card's.
    const half = item.footprint.height / 2;
    const clamped = Math.min(Math.max(meters, half), wallHeight - half);
    if (Math.abs(clamped - mount.elevation) < SAME_EPSILON) return;
    onElevate(clamped);
  };
  const commitPosition = (axis: "x" | "y") => (text: string) => {
    const meters = parseLength(text, unit);
    if (meters === null) return;
    if (Math.abs(meters - item.position[axis]) < SAME_EPSILON) return;
    onMoveTo({ ...item.position, [axis]: meters });
  };

  const lengthField = (
    label: string,
    ariaLabel: string,
    meters: number,
    onCommit: (text: string) => void,
  ) => (
    <Field
      label={label}
      ariaLabel={ariaLabel}
      suffix={unit}
      value={formatLengthValue(meters, unit)}
      onCommit={onCommit}
    />
  );

  const arrangeActions = [
    ...(item.mount
      ? []
      : [
          {
            label: "Rotate",
            ariaLabel: "Rotate 90°",
            icon: RotateCw,
            onClick: onRotate90,
          },
        ]),
    { label: "Clone", ariaLabel: "Duplicate", icon: Copy, onClick: onClone },
  ];

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-[var(--control-border)] bg-[var(--well)]">
          <div
            aria-hidden
            style={{
              width: 92,
              height: 92,
              transform: "scale(0.5217)",
              transformOrigin: "top left",
            }}
          >
            <CatalogThumbnail
              catalogId={item.catalogId}
              className="bg-transparent"
            />
          </div>
        </div>
        <div className="min-w-0">
          <div
            className="truncate font-semibold text-[15px] text-[var(--ink-900)]"
            data-testid="inspector-item-name"
          >
            {furnitureDisplayName(item.catalogId)}
          </div>
          <div className="mt-[2px] truncate text-[12.5px] text-[var(--ink-400)]">
            {catalogItem ? CATALOG_CATEGORY_LABELS[catalogItem.category] : "—"}
            {item.mount ? " · Wall-mounted" : ""}
            {hostName ? ` · On ${hostName}` : ""}
            {roomName ? ` · ${roomName}` : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionLabel>TRANSFORM</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {lengthField(
            "WIDTH",
            "Width",
            item.footprint.width,
            commitSize("width"),
          )}
          {lengthField(
            "DEPTH",
            "Depth",
            item.footprint.depth,
            commitSize("depth"),
          )}
          {lengthField(
            "HEIGHT",
            "Height",
            item.footprint.height,
            commitSize("height"),
          )}
          {item.mount ? (
            lengthField(
              "ELEVATION",
              "Elevation",
              item.mount.elevation,
              commitElevation,
            )
          ) : (
            <Field
              label="ROTATE"
              ariaLabel="Rotation"
              suffix="°"
              value={formatDegrees(item.rotation)}
              onCommit={commitRotation}
            />
          )}
          {!item.mount && (
            <>
              {lengthField(
                "POS X",
                "Position X",
                item.position.x,
                commitPosition("x"),
              )}
              {lengthField(
                "POS Y",
                "Position Y",
                item.position.y,
                commitPosition("y"),
              )}
            </>
          )}
        </div>
      </div>

      {colorways.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <SectionLabel>MATERIAL</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {colorways.map((color) => {
              const selected = color === activeColor;
              const isDefault = color === baseColor;
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={
                    isDefault ? "Default material" : `Material ${color}`
                  }
                  aria-pressed={selected}
                  onClick={() => onRecolor(isDefault ? null : color)}
                  style={{ backgroundColor: color }}
                  className={cn(
                    "h-7 w-7 rounded-full border",
                    selected
                      ? "border-[var(--blue)] ring-2 ring-[var(--blue)] ring-offset-1 ring-offset-[var(--panel)]"
                      : "border-[var(--control-border)]",
                  )}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <SectionLabel>ARRANGE</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {arrangeActions.map(({ label, ariaLabel, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              aria-label={ariaLabel}
              onClick={onClick}
              className="flex flex-col items-center gap-[5px] rounded-[8px] border border-[var(--control-border)] bg-[var(--frame)] py-[9px] text-[var(--ink-600)] hover:bg-[var(--well)]"
            >
              <Icon width={17} height={17} strokeWidth={1.6} />
              <span className="text-[10px] text-[var(--ink-500)]">{label}</span>
            </button>
          ))}
          <button
            type="button"
            aria-label="Delete"
            onClick={onDelete}
            className="flex flex-col items-center gap-[5px] rounded-[8px] border border-[rgba(214,69,69,0.22)] bg-[rgba(214,69,69,0.05)] py-[9px] text-[var(--danger)] hover:bg-[rgba(214,69,69,0.1)]"
          >
            <Trash2 width={17} height={17} strokeWidth={1.6} />
            <span className="text-[10px]">Delete</span>
          </button>
        </div>
      </div>
    </>
  );
}

/** The route-resolved selected opening: the stored shape plus everything the
 * fields need that only the derived rooms know (effective verticals, the
 * ceiling clamp, the portal connection, whether the wall has two rooms). */
export interface OpeningSelection {
  opening: Opening;
  /** Effective hole bottom/top above the floor (`openingVerticals`). */
  bottom: number;
  top: number;
  /** The host edge's ceiling — the head clamp (`edgeCeiling`). */
  ceiling: number;
  /** "Living room ↔ Kitchen" when the opening is a portal, else null. */
  connects: string | null;
  /** The host edge borders two rooms — a door can open either way. */
  twoFace: boolean;
}

interface OpeningSectionProps {
  selection: OpeningSelection;
  unit: Unit;
  /** A committed width from the WIDTH field (clamping is the model's). */
  onResize: (width: number) => void;
  /** Committed sill/head values, meters above the floor (model clamps). */
  onVerticals: (verticals: { bottom?: number; top?: number }) => void;
  onFlipHinge: () => void;
  onFlipSide: () => void;
  onDelete: () => void;
}

function OpeningSection({
  selection,
  unit,
  onResize,
  onVerticals,
  onFlipHinge,
  onFlipSide,
  onDelete,
}: OpeningSectionProps) {
  const { opening, bottom, top } = selection;
  const isDoor = opening.kind === "door";

  const commitLength =
    (apply: (meters: number) => void, current: number) => (text: string) => {
      const meters = parseLength(text, unit);
      if (meters === null) return;
      if (Math.abs(meters - current) < SAME_EPSILON) return;
      apply(meters);
    };

  const lengthField = (
    label: string,
    ariaLabel: string,
    meters: number,
    onCommit: (text: string) => void,
  ) => (
    <Field
      label={label}
      ariaLabel={ariaLabel}
      suffix={unit}
      value={formatLengthValue(meters, unit)}
      onCommit={onCommit}
    />
  );

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-[var(--control-border)] bg-[var(--well)]">
          <div
            aria-hidden
            style={{
              width: 92,
              height: 92,
              transform: "scale(0.5217)",
              transformOrigin: "top left",
            }}
          >
            <CatalogThumbnail
              catalogId={opening.kind}
              className="bg-transparent"
            />
          </div>
        </div>
        <div className="min-w-0">
          <div
            className="truncate font-semibold text-[15px] text-[var(--ink-900)]"
            data-testid="inspector-item-name"
          >
            {isDoor ? "Door" : "Window"}
          </div>
          <div className="mt-[2px] truncate text-[12.5px] text-[var(--ink-400)]">
            {selection.connects ?? CATALOG_CATEGORY_LABELS.openings}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionLabel>TRANSFORM</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {lengthField(
            "WIDTH",
            "Opening width",
            opening.width,
            commitLength(onResize, opening.width),
          )}
          {lengthField(
            "HEIGHT",
            "Opening height",
            top - bottom,
            commitLength(
              (meters) => onVerticals({ top: bottom + meters }),
              top - bottom,
            ),
          )}
          {!isDoor &&
            lengthField(
              "ELEVATION",
              "Sill elevation",
              bottom,
              // Elevation moves the whole window, height preserved — HEIGHT
              // is the sibling field, so the two stay independent.
              commitLength(
                (meters) =>
                  onVerticals({ bottom: meters, top: meters + (top - bottom) }),
                bottom,
              ),
            )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionLabel>ARRANGE</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {isDoor && (
            <button
              type="button"
              aria-label="Flip hinge side"
              onClick={onFlipHinge}
              className="flex flex-col items-center gap-[5px] rounded-[8px] border border-[var(--control-border)] bg-[var(--frame)] py-[9px] text-[var(--ink-600)] hover:bg-[var(--well)]"
            >
              <ArrowLeftRight width={17} height={17} strokeWidth={1.6} />
              <span className="text-[10px] text-[var(--ink-500)]">Hinge</span>
            </button>
          )}
          {isDoor && selection.twoFace && (
            <button
              type="button"
              aria-label="Flip which room it opens into"
              onClick={onFlipSide}
              className="flex flex-col items-center gap-[5px] rounded-[8px] border border-[var(--control-border)] bg-[var(--frame)] py-[9px] text-[var(--ink-600)] hover:bg-[var(--well)]"
            >
              <DoorOpen width={17} height={17} strokeWidth={1.6} />
              <span className="text-[10px] text-[var(--ink-500)]">Swing</span>
            </button>
          )}
          <button
            type="button"
            aria-label="Delete opening"
            onClick={onDelete}
            className="flex flex-col items-center gap-[5px] rounded-[8px] border border-[rgba(214,69,69,0.22)] bg-[rgba(214,69,69,0.05)] py-[9px] text-[var(--danger)] hover:bg-[rgba(214,69,69,0.1)]"
          >
            <Trash2 width={17} height={17} strokeWidth={1.6} />
            <span className="text-[10px]">Delete</span>
          </button>
        </div>
      </div>
    </>
  );
}

export interface InspectorProps {
  /** The floor's derived rooms (footer totals + the room overview). */
  rooms: Room[];
  unit: Unit;
  mode: ViewMode;
  selectedItem: FurnitureItem | null;
  /** Membership readout for the selection: a room name, "—" when unassigned
   * (in no room), or null to hide the line (single-room floor). */
  selectedRoomName?: string | null;
  /** Display name of the furniture the selection stands on, if stacked. */
  selectedHostName?: string | null;
  /** The selection's owning-room ceiling (the elevation clamp), or the
   * default when it sits in no room. */
  selectedWallHeight?: number;
  /** Number of graph nodes (corners), for the draw-mode OUTLINE view. */
  nodeCount?: number;
  /** How many openings sit on the first room's walls (the ROOM overview
   * count) — sourced from `floor.openings`, since derived rooms no longer
   * carry per-wall opening copies. */
  openingCount?: number;
  /** The selected door/window (either lens): its own SELECTION view with
   * editable width/height/elevation and the flip/delete actions. */
  selectedOpening?: OpeningSelection | null;
  onResize: (footprint: Footprint) => void;
  onRotateTo: (deg: number) => void;
  onElevate: (elevation: number) => void;
  onMoveTo: (position: Point) => void;
  onRecolor: (colorway: string | null) => void;
  onRotate90: () => void;
  onClone: () => void;
  onDelete: () => void;
  onOpeningResize?: (width: number) => void;
  onOpeningVerticals?: (verticals: { bottom?: number; top?: number }) => void;
  onOpeningFlipHinge?: () => void;
  onOpeningFlipSide?: () => void;
  onOpeningDelete?: () => void;
}

export function Inspector({
  rooms,
  unit,
  mode,
  selectedItem,
  selectedRoomName = null,
  selectedHostName = null,
  selectedWallHeight = 2.5,
  nodeCount = 0,
  openingCount = 0,
  selectedOpening = null,
  onResize,
  onRotateTo,
  onElevate,
  onMoveTo,
  onRecolor,
  onRotate90,
  onClone,
  onDelete,
  onOpeningResize = () => {},
  onOpeningVerticals = () => {},
  onOpeningFlipHinge = () => {},
  onOpeningFlipSide = () => {},
  onOpeningDelete = () => {},
}: InspectorProps) {
  const drawing = mode === "draw";
  const showSelection = selectedItem !== null && !drawing;
  const showOpening = !showSelection && selectedOpening !== null && !drawing;
  const multiRoom = rooms.length > 1;
  const header = drawing
    ? "OUTLINE"
    : showSelection || showOpening
      ? "SELECTION"
      : multiRoom
        ? "FLOOR"
        : "ROOM";

  // Footer facts are floor totals (equal to the room's own on a one-room
  // floor, so nothing changes until a second room exists).
  const hasOutline = rooms.some((room) => room.outline.length >= 3);
  const area = hasOutline ? totalFloorArea(rooms) : null;
  const perimeter = hasOutline ? totalPerimeter(rooms) : null;
  const firstRoom = rooms[0];

  return (
    <aside
      aria-label="Inspector"
      className="flex min-h-0 flex-col border-[var(--hairline)] border-l bg-[var(--panel)]"
      style={{ gridArea: "inspector" }}
    >
      <div className="border-[var(--hairline)] border-b px-[18px] py-4">
        <SectionLabel>{header}</SectionLabel>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto p-[18px]">
        {drawing ? (
          <div className="flex flex-col gap-2.5">
            <div className="font-semibold text-[15px] text-[var(--ink-900)]">
              Editing walls
            </div>
            <div className="text-[12.5px] text-[var(--ink-500)] leading-relaxed">
              {nodeCount} corner{nodeCount === 1 ? "" : "s"} · {rooms.length}{" "}
              room{rooms.length === 1 ? "" : "s"}
            </div>
            <div className="text-[12.5px] text-[var(--ink-400)] leading-relaxed">
              Drag any corner and every room that shares it follows. Use the
              wall tool to chain new walls (they weld onto what they touch), or
              click a wall to split it. Edit a length label directly; delete
              removes a corner or wall. Undo works live.
            </div>
          </div>
        ) : showSelection ? (
          <SelectionSection
            item={selectedItem}
            wallHeight={selectedWallHeight}
            hostName={selectedHostName}
            roomName={selectedRoomName}
            unit={unit}
            onResize={onResize}
            onRotateTo={onRotateTo}
            onElevate={onElevate}
            onMoveTo={onMoveTo}
            onRecolor={onRecolor}
            onRotate90={onRotate90}
            onClone={onClone}
            onDelete={onDelete}
          />
        ) : showOpening ? (
          <OpeningSection
            selection={selectedOpening}
            unit={unit}
            onResize={onOpeningResize}
            onVerticals={onOpeningVerticals}
            onFlipHinge={onOpeningFlipHinge}
            onFlipSide={onOpeningFlipSide}
            onDelete={onOpeningDelete}
          />
        ) : multiRoom ? (
          <div className="flex flex-col gap-2.5">
            <div
              className="font-semibold text-[15px] text-[var(--ink-900)]"
              data-testid="inspector-room-name"
            >
              {`${rooms.length} rooms`}
            </div>
            <div className="flex flex-col gap-1.5">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="flex items-baseline justify-between text-[12.5px]"
                >
                  <span className="truncate text-[var(--ink-500)]">
                    {room.name ?? "Untitled room"}
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-[var(--ink-400)]">
                    {floorArea(room.outline).toFixed(2)} m²
                  </span>
                </div>
              ))}
            </div>
            <div className="text-[12.5px] text-[var(--ink-400)] leading-relaxed">
              Select an item in either lens to edit its size, rotation and
              position here.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div
              className="font-semibold text-[15px] text-[var(--ink-900)]"
              data-testid="inspector-room-name"
            >
              {firstRoom?.name ?? "Untitled room"}
            </div>
            <div className="text-[12.5px] text-[var(--ink-500)]">
              {firstRoom?.furniture.length ?? 0} object
              {(firstRoom?.furniture.length ?? 0) === 1 ? "" : "s"} ·{" "}
              {openingCount} opening{openingCount === 1 ? "" : "s"}
            </div>
            <div className="text-[12.5px] text-[var(--ink-400)] leading-relaxed">
              Select an item in either lens to edit its size, rotation and
              position here.
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between border-[var(--hairline)] border-t px-[18px] py-4 text-[12px]">
        {[
          ["FLOOR", area === null ? "—" : `${area.toFixed(2)} m²`],
          ["PERIMETER", perimeter === null ? "—" : `${perimeter.toFixed(1)} m`],
          // On a one-room floor the ceiling is unambiguous; with several
          // rooms (each its own height) the slot shows the room count.
          multiRoom
            ? ["ROOMS", `${rooms.length}`]
            : [
                "CEILING",
                firstRoom ? `${wallHeightOf(firstRoom).toFixed(2)} m` : "—",
              ],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-[3px]">
            <span
              className={cn(
                "text-[10px] text-[var(--ink-400)] tracking-[0.05em]",
              )}
            >
              {label}
            </span>
            <span className="font-mono text-[var(--ink-700)]">{value}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
