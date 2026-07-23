import { createFileRoute } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DrawHintBar } from "#/components/draw-hint-bar";
import { type DrawTool, DrawToolStack } from "#/components/draw-tool-stack";
import { FloorChips } from "#/components/floor-chips";
import { Inspector } from "#/components/inspector";
import { NavRail } from "#/components/nav-rail";
import { ObjectsPanel } from "#/components/objects-panel";
import { PlacementDragLayer } from "#/components/placement-drag-layer";
import { SettingsPopover } from "#/components/settings-popover";
import { StatusBar } from "#/components/status-bar";
import { TimeOfDayControl } from "#/components/time-of-day-control";
import { WorkspaceHeader } from "#/components/workspace-header";
import { ZoomPill } from "#/components/zoom-pill";
import { type CameraApi, createCameraReadoutStore } from "#/lib/camera";
import { containRoomFurniture, nudgeFurniture } from "#/lib/collision";
import { rectangleOutline } from "#/lib/draw";
import {
  addWallSegment,
  deleteEdge,
  deleteNode,
  moveNodePreview,
  setEdgeLength,
  settleNodeMove,
  splitEdgeAt,
} from "#/lib/graph-edit";
import {
  commitHistory,
  createHistory,
  previewHistory,
  redoHistory,
  settleHistory,
  undoHistory,
} from "#/lib/history";
import { DEFAULT_TIME_OF_DAY, LIGHTING, type TimeOfDay } from "#/lib/lighting";
import {
  addFloorAbove,
  allFurnitureOf,
  type Bounds,
  type Building,
  type CatalogItem,
  createFloor,
  createSampleFloor,
  DEFAULT_WALL_HEIGHT,
  type DerivedFloor,
  deriveFloor,
  deriveFloorsCached,
  duplicateFurniture,
  edgeCeiling,
  type Floor,
  type Footprint,
  flipFloorOpeningHinge,
  flipFloorOpeningSide,
  floorBounds,
  floorById,
  floorDisplayName,
  floorIndexOf,
  floorOfEdge,
  floorOfItem,
  floorOfOpening,
  floorOfStair,
  furnitureDisplayName,
  openingSill,
  openingVerticals,
  type Point,
  portalLabel,
  type Room,
  reconcileFloor,
  removeFloor,
  removeFloorOpening,
  removeFurniture,
  removeStair,
  renameFloor,
  resizeFloorOpening,
  roomOfFurniture,
  rotateFurniture,
  type SillMaterial,
  type Stair,
  setEdgeThickness,
  setFurnitureColorway,
  setFurnitureFootprint,
  setFurnitureRotation,
  setMountElevation,
  setOpeningSillMaterial,
  setOpeningSillOverhang,
  setOpeningVerticals,
  setRoomName,
  setRoomWallHeight,
  shiftOpeningVertical,
  storeyHeightOf,
  totalFloorArea,
  unionBounds,
  updateDerivedRoom,
  updateFloorFurniture,
  updateFloorIn,
  updateFurniture,
  updateStair,
  WALL_THICKNESS,
  wallHeightOf,
} from "#/lib/model";
import {
  deserializeSavedState,
  STORAGE_KEY,
  serializeSavedState,
} from "#/lib/persistence";
import { edgeWallObstacles, type Obstacle, PLACEMENT_GRID } from "#/lib/place";
import { buildEdgeSolids, sunAnchorAzimuth } from "#/lib/room-scene";
import { stairRun, stairValid, stairVoidObstacles } from "#/lib/stairs";
import type { Unit } from "#/lib/units";
import type { ViewMode } from "#/lib/view-mode";

/** Shift-arrow nudge step, meters — the "fine" 1 cm move. */
const FINE_NUDGE_STEP = 0.01;

// Loaded lazily after mount: the three.js scene is client-only, so keep it
// out of the SSR pass entirely.
const PlannerCanvas = lazy(() =>
  import("#/components/planner-canvas").then((module) => ({
    default: module.PlannerCanvas,
  })),
);

export const Route = createFileRoute("/")({ component: Planner });

function Planner() {
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  // The docked objects library (screen 2d). A panel, not a mode: it coexists
  // with the inspector in either furnish lens and only the draw task hides
  // it (the flag survives a draw round trip).
  const [libraryOpen, setLibraryOpen] = useState(false);
  // The lens to return to when the rail's Furnish button exits draw mode.
  const lastLensRef = useRef<"2d" | "3d">("3d");
  useEffect(() => {
    if (viewMode !== "draw") lastLensRef.current = viewMode;
  }, [viewMode]);
  const handleFurnish = useCallback(() => {
    if (viewMode === "draw") {
      // Furnish from draw = "I want to place objects now": back to the last
      // lens with the library docked.
      setViewMode(lastLensRef.current);
      setLibraryOpen(true);
    } else {
      setLibraryOpen((open) => !open);
    }
  }, [viewMode]);
  // The building lives inside a bounded undo/redo history; the active floor
  // id is separate UI state (undo-clamped below), not part of the history
  // itself — undo/redo travel the whole building, never just one storey.
  // Discrete mutations (add/rotate/duplicate/delete, opening edits, outline
  // close) go through `commitFloor` = one undo step each; the continuous
  // drags stream through `previewFloorIn` and fold into a single step when
  // `settleRoom` fires at gesture end — an esc-cancelled drag leaves no step
  // at all.
  const [buildingHistory, setBuildingHistory] = useState(() =>
    createHistory<Building>({ floors: [createSampleFloor()] }),
  );
  const building = buildingHistory.current;
  // Live building for handlers that must compute an edit *and* read its
  // result synchronously, mirroring `floorRef` below.
  const buildingRef = useRef(building);
  buildingRef.current = building;
  const [activeFloorId, setActiveFloorId] = useState(
    () => buildingHistory.current.floors[0].id,
  );
  // Read inside history updaters instead of closing over `activeFloorId`
  // directly — closures captured by a `useCallback(fn, [])` (stable-identity)
  // handler would otherwise go stale the moment the active floor changes.
  const activeFloorIdRef = useRef(activeFloorId);
  activeFloorIdRef.current = activeFloorId;
  const floor = floorById(building, activeFloorId) ?? building.floors[0];
  // Live floor for handlers that must compute a graph edit *and* read its
  // result synchronously (chain extend / split-then-drag both need the id the
  // reconcile minted before the state update flushes).
  const floorRef = useRef(floor);
  floorRef.current = floor;
  // Rooms are *derived* from the graph (`deriveFloor`): scenes, readouts, and
  // every per-room edit speak this `Room[]` view; the graph `Floor` is what
  // history/persistence hold. Derived over every storey (not just the active
  // one) so the floor chips/settings/inspector can summarize the whole
  // building without re-deriving per read; the active floor's entry is what
  // the canvas and every per-room edit still see. `deriveFloorsCached` reuses
  // the prior render's `DerivedFloor` for any floor whose object reference
  // didn't change — a preview drag on one floor mints a new `Building` on
  // every pointermove, but every *other* floor keeps its own reference, so
  // this ref-held cache keeps every untouched floor from re-deriving on
  // every frame of a drag confined to one other floor.
  const derivedCacheRef = useRef<Map<Floor, DerivedFloor>>(new Map());
  const derivedByFloor = useMemo(() => {
    const { byId, cache } = deriveFloorsCached(
      building.floors,
      derivedCacheRef.current,
    );
    derivedCacheRef.current = cache;
    return byId;
  }, [building]);
  const derived = derivedByFloor.get(floor.id) ?? deriveFloor(floor);
  // The first derived room anchors the header breadcrumb; everything
  // selection-shaped resolves its owning room from the item id instead.
  const room = derived.rooms[0] as Room | undefined;
  // One floor's discrete mutation, addressed by floor id — one undo step at
  // the building level. Same-reference no-op (either `fn` itself, or the
  // building not knowing `floorId`) lands nowhere.
  const commitFloor = useCallback(
    (floorId: string, fn: (floor: Floor) => Floor) => {
      setBuildingHistory((history) => {
        const next = updateFloorIn(history.current, floorId, fn);
        return next === history.current
          ? history
          : commitHistory(history, next);
      });
    },
    [],
  );
  // A mid-drag single-floor state (an opening slide, a node drag): a preview
  // like a furniture drag's, folded into one step when the drag settles.
  const previewFloorIn = useCallback(
    (floorId: string, fn: (floor: Floor) => Floor) => {
      setBuildingHistory((history) => {
        const next = updateFloorIn(history.current, floorId, fn);
        return next === history.current
          ? history
          : previewHistory(history, next);
      });
    },
    [],
  );
  // Whole-active-floor commits/previews (draw mode's edits, opening edits,
  // the `PlannerCanvas` wiring) keep these exact names so their prop types
  // don't change — they resolve the target floor id from the ref at call
  // time (see `activeFloorIdRef` above), never from a closed-over value.
  const setFloor = useCallback(
    (next: Floor) => commitFloor(activeFloorIdRef.current, () => next),
    [commitFloor],
  );
  const previewFloor = useCallback(
    // `floorId` targets a floor other than the active one (the 3D stack's
    // cross-floor furniture drags land here via the canvas's `onFloorPreview`);
    // omitted, it defaults to the active floor, unchanged from before.
    (next: Floor, floorId?: string) =>
      previewFloorIn(floorId ?? activeFloorIdRef.current, () => next),
    [previewFloorIn],
  );
  // One derived room's discrete mutation, addressed by floor + room id — one
  // undo step. `updateDerivedRoom` runs the edit back through the graph and
  // keeps the pure setters' no-op contract at floor level (a same-reference
  // room yields the same floor, which must not become an empty undo step).
  // Rooms can belong to any floor now — the settings popover lists every
  // floor's rooms, not just the active one's.
  const commitToRoom = useCallback(
    (floorId: string, targetId: string, update: (room: Room) => Room) => {
      setBuildingHistory((history) => {
        const next = updateFloorIn(history.current, floorId, (floor) =>
          updateDerivedRoom(floor, deriveFloor(floor), targetId, update),
        );
        return next === history.current
          ? history
          : commitHistory(history, next);
      });
    },
    [],
  );
  const settleRoom = useCallback(() => setBuildingHistory(settleHistory), []);
  const undoRoom = useCallback(() => setBuildingHistory(undoHistory), []);
  const redoRoom = useCallback(() => setBuildingHistory(redoHistory), []);
  // Draw edits the graph live (Phase 9) — undo/redo stay active in draw mode,
  // like every other lens.
  const canUndo = buildingHistory.past.length > 0;
  const canRedo = buildingHistory.future.length > 0;
  // Undo/redo can land the active floor id on a since-removed floor (a future
  // floor-delete's undo/redo, not reachable yet in a one-floor building):
  // clamp back to the nearest surviving index instead of falling over.
  const prevFloorIndexRef = useRef(0);
  useEffect(() => {
    if (!floorById(building, activeFloorId)) {
      setActiveFloorId(
        building.floors[
          Math.min(prevFloorIndexRef.current, building.floors.length - 1)
        ].id,
      );
    } else {
      prevFloorIndexRef.current = floorIndexOf(building, activeFloorId);
    }
  }, [building, activeFloorId]);
  const [unit, setUnit] = useState<Unit>("m");
  // The furniture selection is route state so the inspector (outside the
  // canvas) and the in-scene picking/label share one selection. The canvas
  // keeps opening selection internal and clears this one when it takes over.
  // Selection is floor-wide: the item is found across every room plus the
  // unassigned (open-canvas) bucket, and its room membership is a readout.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Selection can land on any floor now (a 3D-stack pick through a lower
  // storey's doorway-side view) — every readout below resolves the item's
  // *owning* floor rather than assuming the active one, falling back to the
  // active floor when nothing is selected (or the id is stale).
  const selectedFloor = selectedId
    ? (floorOfItem(building, selectedId) ?? floor)
    : floor;
  const selectedFloorDerived =
    selectedFloor === floor
      ? derived
      : (derivedByFloor.get(selectedFloor.id) ?? deriveFloor(selectedFloor));
  const selectedFloorFurniture = useMemo(
    () =>
      allFurnitureOf(
        selectedFloorDerived.rooms,
        selectedFloorDerived.unassignedFurniture,
      ),
    [selectedFloorDerived],
  );
  const selectedItem = selectedId
    ? (selectedFloorFurniture.find((item) => item.id === selectedId) ?? null)
    : null;
  const selectedRoom = selectedId
    ? (roomOfFurniture(selectedFloorDerived.rooms, selectedId) ?? null)
    : null;
  const multiRoom = selectedFloorDerived.rooms.length > 1;
  // Membership readout for the inspector/status bar: the room name on a
  // multi-room floor, "—" when the item sits in no room, else hidden.
  const selectedRoomName = selectedItem
    ? selectedRoom
      ? multiRoom
        ? (selectedRoom.name ?? "Untitled room")
        : null
      : "—"
    : null;
  const selectedHostName =
    selectedItem?.stack != null
      ? furnitureDisplayName(
          selectedFloorFurniture.find(
            (f) => f.id === selectedItem.stack?.hostId,
          )?.catalogId ?? "",
        )
      : null;
  const selectedWallHeight = selectedRoom
    ? wallHeightOf(selectedRoom)
    : DEFAULT_WALL_HEIGHT;
  // The opening selection (2D lens) lives here too, so the status bar and
  // inspector can label a portal — an opening on a wall two rooms share —
  // with the connection it makes. Derived from geometry, never stored.
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    null,
  );
  // The wall selection (either furnish lens): a graph edge picked by
  // clicking its body. Mutually exclusive with the furniture and opening
  // selections; the inspector edits its thickness.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const selectedWall = useMemo(() => {
    if (!selectedEdgeId || viewMode === "draw") return null;
    // A wall pick can land on any storey (the 3D stack's lower entries pick
    // too) — resolve the owning floor rather than assuming the active one.
    const owner = floorOfEdge(building, selectedEdgeId);
    if (!owner) return null;
    const edge = owner.edges.find((e) => e.id === selectedEdgeId);
    if (!edge) return null;
    const a = owner.nodes.find((n) => n.id === edge.a);
    const b = owner.nodes.find((n) => n.id === edge.b);
    if (!a || !b) return null;
    const ownerDerived =
      owner === floor
        ? derived
        : (derivedByFloor.get(owner.id) ?? deriveFloor(owner));
    const faces = ownerDerived.rooms.filter((r) =>
      r.wallRefs.some((ref) => ref.edgeId === edge.id),
    ).length;
    const twoFace = faces === 2;
    return {
      edgeId: edge.id,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      thickness: twoFace ? WALL_THICKNESS : (edge.thickness ?? WALL_THICKNESS),
      twoFace,
    };
  }, [selectedEdgeId, viewMode, building, floor, derived, derivedByFloor]);
  const setWallThickness = useCallback(
    (meters: number) => {
      if (!selectedEdgeId) return;
      const owner = floorOfEdge(buildingRef.current, selectedEdgeId);
      if (!owner) return;
      commitFloor(owner.id, (floor) =>
        setEdgeThickness(floor, selectedEdgeId, meters),
      );
    },
    [selectedEdgeId, commitFloor],
  );
  // The stair selection (V8, either lens): an id picked on its own tread
  // symbol/mesh or the void it cuts on the floor above. Mutually exclusive
  // with the other three; the inspector edits width/rotation/position.
  const [selectedStairId, setSelectedStairId] = useState<string | null>(null);
  const selectedStair = useMemo(() => {
    if (!selectedStairId || viewMode === "draw") return null;
    // A stair pick can land on any storey too — resolve the owning floor.
    const owner = floorOfStair(building, selectedStairId);
    if (!owner) return null;
    const stair = owner.stairs.find((s) => s.id === selectedStairId);
    if (!stair) return null;
    const ownerIndex = floorIndexOf(building, owner.id);
    return {
      stair,
      run: stairRun(storeyHeightOf(owner)).run,
      rises: `${floorDisplayName(building, ownerIndex)} → ${floorDisplayName(building, ownerIndex + 1)}`,
    };
  }, [selectedStairId, viewMode, building]);
  // One stair edit, shared by every commit path (WIDTH/ROTATE/POS X/Y
  // fields, the keyboard's `r`): builds the patched stair and validity-gates
  // it (`stairValid`, against both the owning floor's and the floor-above's
  // wall slabs) *before* committing — invalid patches no-op, so a field
  // snaps back exactly like a rejected furniture resize. `patch` may be a
  // function of the current stair (for a relative edit like +90°) so callers
  // never have to re-read `stair.rotation` themselves.
  const patchStair = useCallback(
    (
      patch:
        | Partial<Omit<Stair, "id">>
        | ((stair: Stair) => Partial<Omit<Stair, "id">>),
    ) => {
      if (!selectedStairId) return;
      const owner = floorOfStair(buildingRef.current, selectedStairId);
      if (!owner) return;
      const stair = owner.stairs.find((s) => s.id === selectedStairId);
      if (!stair) return;
      const resolved = typeof patch === "function" ? patch(stair) : patch;
      const candidateBuilding = updateFloorIn(
        buildingRef.current,
        owner.id,
        (f) => updateStair(f, selectedStairId, resolved),
      );
      const candidateStair = floorById(
        candidateBuilding,
        owner.id,
      )?.stairs.find((s) => s.id === selectedStairId);
      if (!candidateStair) return;
      if (!stairValid(candidateBuilding, owner.id, candidateStair)) return;
      commitFloor(owner.id, (f) => updateStair(f, selectedStairId, resolved));
    },
    [selectedStairId, commitFloor],
  );
  const resizeSelectedStair = useCallback(
    (width: number) => patchStair({ width }),
    [patchStair],
  );
  const rotateSelectedStairTo = useCallback(
    (deg: number) => patchStair({ rotation: deg }),
    [patchStair],
  );
  const rotateSelectedStair90 = useCallback(
    () => patchStair((stair) => ({ rotation: (stair.rotation + 90) % 360 })),
    [patchStair],
  );
  const moveSelectedStairTo = useCallback(
    (position: Point) => patchStair({ position }),
    [patchStair],
  );
  const deleteSelectedStair = useCallback(() => {
    if (!selectedStairId) return;
    const owner = floorOfStair(buildingRef.current, selectedStairId);
    if (owner) {
      commitFloor(owner.id, (f) => removeStair(f, selectedStairId));
    }
    setSelectedStairId(null);
  }, [selectedStairId, commitFloor]);
  // An arrow-key nudge on the selected stair: same functional-preview burst
  // as furniture's `nudgeSelected`, but validity-gated per step (against the
  // pre-step floor from `buildingRef.current`, whose walls don't change from
  // a stair edit) — an invalid step is simply skipped, so the burst stalls
  // at a wall instead of tunneling through it.
  const nudgeSelectedStair = useCallback(
    (dx: number, dy: number) => {
      if (!selectedStairId) return;
      const owner = floorOfStair(buildingRef.current, selectedStairId);
      if (!owner) return;
      const stair = owner.stairs.find((s) => s.id === selectedStairId);
      if (!stair) return;
      const candidate: Stair = {
        ...stair,
        position: { x: stair.position.x + dx, y: stair.position.y + dy },
      };
      if (!stairValid(buildingRef.current, owner.id, candidate)) return;
      previewFloorIn(owner.id, (f) =>
        updateStair(f, selectedStairId, { position: candidate.position }),
      );
    },
    [selectedStairId, previewFloorIn],
  );
  // Everything the inspector's opening view needs, resolved once: effective
  // verticals, the host edge's ceiling, the portal label, whether the wall
  // borders two rooms, the resolved sill. Openings are editable in both
  // furnish lenses.
  const selectedOpening = useMemo(() => {
    if (!selectedOpeningId || viewMode === "draw") return null;
    // Same cross-storey resolution as the wall/furniture selections: an
    // opening pick can land on any floor of the 3D stack.
    const owner = floorOfOpening(building, selectedOpeningId);
    if (!owner) return null;
    const opening = owner.openings.find((o) => o.id === selectedOpeningId);
    if (!opening) return null;
    const ownerDerived =
      owner === floor
        ? derived
        : (derivedByFloor.get(owner.id) ?? deriveFloor(owner));
    const { bottom, top } = openingVerticals(opening);
    const sill = openingSill(opening);
    return {
      opening,
      bottom,
      top,
      sillOverhang: sill.overhang,
      sillMaterial: sill.material,
      ceiling: edgeCeiling(ownerDerived.rooms, opening.edgeId),
      connects: portalLabel(ownerDerived.rooms, owner, opening.id),
      twoFace:
        ownerDerived.rooms.filter((r) =>
          r.wallRefs.some((ref) => ref.edgeId === opening.edgeId),
        ).length === 2,
    };
  }, [selectedOpeningId, viewMode, building, floor, derived, derivedByFloor]);
  const portalStatus = useMemo(() => {
    if (!selectedOpening?.connects) return null;
    const kind = selectedOpening.opening.kind === "door" ? "Door" : "Window";
    return `${kind} connects ${selectedOpening.connects}`;
  }, [selectedOpening]);
  // Inspector opening commits: one history step each, clamping in the model
  // setters (a same-reference no-op lands nowhere).
  const resizeSelectedOpening = useCallback(
    (width: number) => {
      if (!selectedOpeningId) return;
      const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
      if (!owner) return;
      commitFloor(owner.id, (floor) =>
        resizeFloorOpening(floor, selectedOpeningId, width),
      );
    },
    [selectedOpeningId, commitFloor],
  );
  const setSelectedOpeningVerticals = useCallback(
    (verticals: { bottom?: number; top?: number }) => {
      if (!selectedOpening) return;
      const owner = floorOfOpening(
        buildingRef.current,
        selectedOpening.opening.id,
      );
      if (!owner) return;
      commitFloor(owner.id, (floor) =>
        setOpeningVerticals(
          floor,
          selectedOpening.opening.id,
          verticals,
          selectedOpening.ceiling,
        ),
      );
    },
    [selectedOpening, commitFloor],
  );
  const shiftSelectedOpening = useCallback(
    // ELEVATION moves the whole hole, height preserved — the model slides it
    // into the free vertical stretch (a stacked neighbor clamps, never
    // squishes).
    (bottom: number) => {
      if (!selectedOpening) return;
      const owner = floorOfOpening(
        buildingRef.current,
        selectedOpening.opening.id,
      );
      if (!owner) return;
      commitFloor(owner.id, (floor) =>
        shiftOpeningVertical(
          floor,
          selectedOpening.opening.id,
          bottom,
          selectedOpening.ceiling,
        ),
      );
    },
    [selectedOpening, commitFloor],
  );
  const setSelectedOpeningSillOverhang = useCallback(
    (meters: number) => {
      if (!selectedOpeningId) return;
      const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
      if (!owner) return;
      commitFloor(owner.id, (floor) =>
        setOpeningSillOverhang(floor, selectedOpeningId, meters),
      );
    },
    [selectedOpeningId, commitFloor],
  );
  const setSelectedOpeningSillMaterial = useCallback(
    (material: SillMaterial) => {
      if (!selectedOpeningId) return;
      const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
      if (!owner) return;
      commitFloor(owner.id, (floor) =>
        setOpeningSillMaterial(floor, selectedOpeningId, material),
      );
    },
    [selectedOpeningId, commitFloor],
  );
  const flipSelectedOpeningHinge = useCallback(() => {
    if (!selectedOpeningId) return;
    const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
    if (!owner) return;
    commitFloor(owner.id, (floor) =>
      flipFloorOpeningHinge(floor, selectedOpeningId),
    );
  }, [selectedOpeningId, commitFloor]);
  const flipSelectedOpeningSide = useCallback(() => {
    if (!selectedOpeningId) return;
    const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
    if (!owner) return;
    commitFloor(owner.id, (floor) =>
      flipFloorOpeningSide(floor, selectedOpeningId),
    );
  }, [selectedOpeningId, commitFloor]);
  const deleteSelectedOpening = useCallback(() => {
    if (!selectedOpeningId) return;
    const owner = floorOfOpening(buildingRef.current, selectedOpeningId);
    if (owner) {
      commitFloor(owner.id, (floor) =>
        removeFloorOpening(floor, selectedOpeningId),
      );
    }
    setSelectedOpeningId(null);
  }, [selectedOpeningId, commitFloor]);
  // Containment obstacles beyond a floor's own wall slabs: the stair voids
  // the floor immediately below it cuts into its platform (empty when
  // there's no floor below). Shared by every route-level containment site
  // (`mutateFurniture`, `nudgeSelected`) so furniture can't be dragged or
  // nudged into a stairwell opening.
  const extraObstaclesFor = useCallback((floorId: string): Obstacle[] => {
    const index = floorIndexOf(buildingRef.current, floorId);
    if (index <= 0) return [];
    const below = buildingRef.current.floors[index - 1];
    return stairVoidObstacles(below, storeyHeightOf(below));
  }, []);
  // One floor-level furniture commit, targeting the selected item's owning
  // floor: the pure setter runs over that floor's whole furniture
  // (`updateFloorFurniture`), re-contained against the wall slabs — furniture
  // is floor-level, so an item may sit in any room, the dead band at a shared
  // wall, or the open canvas, bounded only by the walls. One history step; a
  // same-reference no-op lands nowhere.
  const mutateFurniture = useCallback(
    (fn: (room: Room, wallObstacles: Obstacle[]) => Room) => {
      if (!selectedId) return;
      const owner = floorOfItem(buildingRef.current, selectedId);
      if (!owner) return;
      commitFloor(owner.id, (floor) => {
        const wallObstacles = [
          ...edgeWallObstacles(floor),
          ...extraObstaclesFor(floor.id),
        ];
        return updateFloorFurniture(floor, (room) => fn(room, wallObstacles));
      });
    },
    [selectedId, commitFloor, extraObstaclesFor],
  );
  // Inspector commits: one history step each. The pure setters return the
  // room unchanged (same reference) for no-ops, which must not become empty
  // undo steps. Rotations/resizes re-contain the item so it can't poke out.
  const rotateSelected90 = useCallback(() => {
    if (!selectedId) return;
    mutateFurniture((room, walls) =>
      containRoomFurniture(
        walls,
        rotateFurniture(room, selectedId, 90),
        selectedId,
      ),
    );
  }, [selectedId, mutateFurniture]);
  const cloneSelected = useCallback(() => {
    if (!selectedId) return;
    const newId = crypto.randomUUID();
    mutateFurniture((room, walls) =>
      containRoomFurniture(
        walls,
        duplicateFurniture(room, selectedId, newId),
        newId,
      ),
    );
    // Selection follows the copy, like a drop.
    setSelectedId(newId);
  }, [selectedId, mutateFurniture]);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    mutateFurniture((room) => removeFurniture(room, selectedId));
    setSelectedId(null);
  }, [selectedId, mutateFurniture]);
  const resizeSelected = useCallback(
    (footprint: Footprint) => {
      if (!selectedId) return;
      mutateFurniture((room, walls) => {
        const next = setFurnitureFootprint(room, selectedId, footprint);
        return next === room
          ? room
          : containRoomFurniture(walls, next, selectedId);
      });
    },
    [selectedId, mutateFurniture],
  );
  const rotateSelectedTo = useCallback(
    (deg: number) => {
      if (!selectedId) return;
      mutateFurniture((room, walls) => {
        const next = setFurnitureRotation(room, selectedId, deg);
        return next === room
          ? room
          : containRoomFurniture(walls, next, selectedId);
      });
    },
    [selectedId, mutateFurniture],
  );
  const elevateSelected = useCallback(
    (elevation: number) => {
      if (!selectedId) return;
      mutateFurniture((room) => setMountElevation(room, selectedId, elevation));
    },
    [selectedId, mutateFurniture],
  );
  const moveSelectedTo = useCallback(
    (position: Point) => {
      if (!selectedId) return;
      mutateFurniture((room, walls) =>
        containRoomFurniture(
          walls,
          updateFurniture(room, selectedId, { position }),
          selectedId,
        ),
      );
    },
    [selectedId, mutateFurniture],
  );
  const recolorSelected = useCallback(
    (colorway: string | null) => {
      if (!selectedId) return;
      mutateFurniture((room) =>
        setFurnitureColorway(room, selectedId, colorway),
      );
    },
    [selectedId, mutateFurniture],
  );
  // A live pointer drag in either lens (furniture move, rotate handle,
  // opening slide). Settling on end folds the drag's previews into one
  // history step; while one runs the keyboard editing below stands down —
  // the drag owns the keys (its esc restores, not deselects).
  const [sceneDragActive, setSceneDragActive] = useState(false);
  const handleRoomDragActive = useCallback(
    (active: boolean) => {
      setSceneDragActive(active);
      if (!active) settleRoom();
    },
    [settleRoom],
  );
  // An arrow-key nudge: a preview (like a drag's pointermoves), read through
  // the functional update so a key-repeat burst never works from a stale
  // floor. `nudgeFurniture` owns the semantics: push up to the wall slabs and
  // stop (anywhere — room, dead band, open canvas), mounts pass through,
  // riders re-anchor on their host.
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selectedId) return;
      const owner = floorOfItem(buildingRef.current, selectedId);
      if (!owner) return;
      previewFloorIn(owner.id, (floor) => {
        const wallObstacles = [
          ...edgeWallObstacles(floor),
          ...extraObstaclesFor(floor.id),
        ];
        return updateFloorFurniture(floor, (room) =>
          nudgeFurniture(wallObstacles, room, selectedId, dx, dy),
        );
      });
    },
    [selectedId, previewFloorIn, extraObstaclesFor],
  );
  // The Settings rail button's popover: per-room name + ceiling height, each
  // commit one history step through the pure room setters (no-ops return the
  // same reference and land nowhere).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = useCallback(() => setSettingsOpen((on) => !on), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const renameRoom = useCallback(
    (floorId: string, targetId: string, name: string) =>
      commitToRoom(floorId, targetId, (current) => setRoomName(current, name)),
    [commitToRoom],
  );
  const setCeilingHeight = useCallback(
    (floorId: string, targetId: string, meters: number) =>
      commitToRoom(floorId, targetId, (current) =>
        setRoomWallHeight(current, meters),
      ),
    [commitToRoom],
  );
  // Floor management: add a new empty storey on top (its id known up front so
  // the active floor can jump straight to it), rename one, or remove one.
  // `addFloorAbove`/`removeFloor` are pure Building→Building setters (V1);
  // wiring them here is the only new history-touching surface.
  const addFloor = useCallback(() => {
    const newId = crypto.randomUUID();
    setBuildingHistory((history) =>
      commitHistory(
        history,
        addFloorAbove(history.current, () => newId),
      ),
    );
    setActiveFloorId(newId);
  }, []);
  const renameFloorCmd = useCallback((floorId: string, name: string) => {
    setBuildingHistory((history) => {
      const next = renameFloor(history.current, floorId, name);
      return next === history.current ? history : commitHistory(history, next);
    });
  }, []);
  // Deleting the active floor moves `activeFloorId` to the nearest surviving
  // index in the *same* tick as the commit (both land in one React batch) so
  // the undo-clamp effect never observes a building whose active id just
  // vanished. Deleting any other floor leaves the active id untouched (it's
  // still there).
  const deleteFloor = useCallback((floorId: string) => {
    const current = buildingRef.current;
    const next = removeFloor(current, floorId);
    if (next === current) return; // last-floor no-op
    if (activeFloorIdRef.current === floorId) {
      const removedIndex = floorIndexOf(current, floorId);
      const newIndex = Math.min(removedIndex, next.floors.length - 1);
      setActiveFloorId(next.floors[newIndex].id);
    }
    setBuildingHistory((history) => commitHistory(history, next));
  }, []);
  // A floor-chip click: the target floor may hide content the current
  // selections point at (a different storey's furniture/opening/wall), so a
  // switch always resets focus rather than carrying a selection across.
  const selectFloor = useCallback((floorId: string) => {
    setActiveFloorId(floorId);
    setSelectedId(null);
    setSelectedOpeningId(null);
    setSelectedEdgeId(null);
    setSelectedStairId(null);
  }, []);
  // Bottom-left view toggles. Grid shows the in-scene reference grid; snap
  // gates draw/placement quantize + flush snapping. Both default on, matching
  // the lit state the mockups show.
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  // Ghost underlay (V6): the storey directly below the active floor, traced
  // in the 2D and draw lenses. Session-only, like the toggles above — not
  // persisted.
  const [underlayVisible, setUnderlayVisible] = useState(true);
  // Time-of-day lighting for the 3D lens (ephemeral, like the toggles above).
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(DEFAULT_TIME_OF_DAY);
  // Manual sun-anchor azimuth from the dial (degrees, world atan2(z,x));
  // null = automatic (outside the most-glazed wall). Persisted with the room,
  // unlike the hour — orientation is a fact about the home.
  const [sunAzimuthDeg, setSunAzimuthDeg] = useState<number | null>(null);
  const autoSunAnchorDeg = useMemo(
    () =>
      (sunAnchorAzimuth(buildEdgeSolids(floor, derived.rooms)) * 180) / Math.PI,
    [floor, derived.rooms],
  );
  const sunAnchorDeg = sunAzimuthDeg ?? autoSunAnchorDeg;
  // The dial aims the *actual* sun (anchor + the preset's rake); store the
  // anchor so presets keep swinging their daily arc around the aimed point.
  const handleAimSun = useCallback(
    (aimedDeg: number) => {
      const anchor = aimedDeg - LIGHTING[timeOfDay].sun.rakeDeg;
      setSunAzimuthDeg((((anchor % 360) + 540) % 360) - 180);
    },
    [timeOfDay],
  );
  const handleResetSun = useCallback(() => setSunAzimuthDeg(null), []);
  // Fullscreen targets the workspace pane (canvas + its chrome), so the nav
  // rail drops away but the toolbars ride along.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }, []);
  const cameraApiRef = useRef<CameraApi | null>(null);
  const [readoutStore] = useState(createCameraReadoutStore);
  const [canvasReady, setCanvasReady] = useState(false);
  useEffect(() => {
    setCanvasReady(true);
  }, []);

  // Autosave: hydrate once after mount (SSR renders the sample floor —
  // localStorage only exists on the client), then write back on every
  // building or unit change. `lastSavedRef` holds the last payload written or
  // loaded, so hydration itself doesn't count as a save and reloads keep the
  // honest saved-at time instead of resetting the clock to "just now". Older
  // payload versions can't be reconstructed as a wall graph, so a stale or
  // malformed save is discarded (hydrates as the sample floor) — no
  // migration.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    const saved = deserializeSavedState(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      // Hydration replaces the pre-mount sample building outright —
      // resetting history keeps it out of the undo stack.
      setBuildingHistory(createHistory(saved.building));
      setActiveFloorId(saved.building.floors[0].id);
      setUnit(saved.unit);
      setSunAzimuthDeg(saved.sunAzimuthDeg ?? null);
      setSavedAt(saved.savedAt);
      lastSavedRef.current = JSON.stringify({
        building: saved.building,
        unit: saved.unit,
        sunAzimuthDeg: saved.sunAzimuthDeg ?? null,
      });
    }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    const payload = JSON.stringify({ building, unit, sunAzimuthDeg });
    if (payload === lastSavedRef.current) return;
    lastSavedRef.current = payload;
    const now = Date.now();
    localStorage.setItem(
      STORAGE_KEY,
      serializeSavedState({
        building,
        unit,
        savedAt: now,
        sunAzimuthDeg: sunAzimuthDeg ?? undefined,
      }),
    );
    setSavedAt(now);
  }, [storageReady, building, unit, sunAzimuthDeg]);

  // Draw mode edits the wall graph live (Phase 9). Session state is just the
  // active tool plus the chain's last node id (wall tool; null = no chain);
  // there is no draft/commit — every edit is a normal graph mutation with
  // normal undo.
  const [drawTool, setDrawTool] = useState<DrawTool>("select");
  const [chainNode, setChainNode] = useState<string | null>(null);
  // Switching tools ends any open chain (a half-drawn wall never carries over).
  const handleDrawToolChange = useCallback((tool: DrawTool) => {
    setChainNode(null);
    setDrawTool(tool);
  }, []);
  // Leaving draw mode ends the chain too.
  useEffect(() => {
    if (viewMode !== "draw") setChainNode(null);
  }, [viewMode]);

  // A live placement drag from the objects panel. Owned here so the header
  // status line, the panel's "placing…" card, the DOM drag layer and the
  // in-scene ghost all read one session.
  const [placing, setPlacing] = useState<{
    item: CatalogItem;
    origin: { x: number; y: number };
  } | null>(null);
  const startPlacing = useCallback(
    (item: CatalogItem, origin: { x: number; y: number }) =>
      setPlacing({ item, origin }),
    [],
  );
  const endPlacing = useCallback(() => setPlacing(null), []);
  // Entering draw or closing the library mid-drag (Escape only cancels the
  // drag) drops the session with it.
  useEffect(() => {
    if (viewMode === "draw" || !libraryOpen) setPlacing(null);
  }, [viewMode, libraryOpen]);

  // Wall tool: extend the chain by one wall (`from` → `to`). One undo step
  // each; the chain's next node is the reconciled node nearest the landed
  // point (welding onto an existing corner returns that corner's id).
  const extendChain = useCallback(
    (from: Point, to: Point) => {
      const current = floorRef.current;
      const next = addWallSegment(current, from, to);
      if (next === current) return;
      let landed: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of next.nodes) {
        const d = Math.hypot(node.x - to.x, node.y - to.y);
        if (d < bestDistance) {
          bestDistance = d;
          landed = node.id;
        }
      }
      commitFloor(activeFloorIdRef.current, () => next);
      setChainNode(landed);
    },
    [commitFloor],
  );
  const endChain = useCallback(() => setChainNode(null), []);
  // Rect tool: compose the four walls into ONE floor value → one undo step,
  // then hand off to Select (drag corners / edit lengths like any wall).
  const placeRect = useCallback(
    (a: Point, b: Point) => {
      const corners = rectangleOutline(a, b);
      if (!corners) return;
      commitFloor(activeFloorIdRef.current, (floor) => {
        let f = floor;
        for (let i = 0; i < 4; i++) {
          f = addWallSegment(f, corners[i], corners[(i + 1) % 4]);
        }
        return f;
      });
      setDrawTool("select");
    },
    [commitFloor],
  );
  // A node drag: previews stream (raw, no weld mid-gesture), the release
  // settles into one step (welds fire in `settleNodeMove`), esc restores the
  // node to where the drag began (no step at all).
  const nodeMovePreview = useCallback(
    (nodeId: string, point: Point) =>
      previewFloorIn(activeFloorIdRef.current, (floor) =>
        moveNodePreview(floor, nodeId, point),
      ),
    [previewFloorIn],
  );
  const nodeMoveSettle = useCallback((nodeId: string, point: Point) => {
    const floorId = activeFloorIdRef.current;
    setBuildingHistory((history) =>
      settleHistory(
        previewHistory(
          history,
          updateFloorIn(history.current, floorId, (floor) =>
            settleNodeMove(floor, nodeId, point),
          ),
        ),
      ),
    );
  }, []);
  const nodeMoveCancel = useCallback((nodeId: string, original: Point) => {
    const floorId = activeFloorIdRef.current;
    setBuildingHistory((history) =>
      settleHistory(
        previewHistory(
          history,
          updateFloorIn(history.current, floorId, (floor) =>
            moveNodePreview(floor, nodeId, original),
          ),
        ),
      ),
    );
  }, []);
  // Select tool: drag a wall to split it and drag the new node (a plain click
  // selects the wall instead, in-scene). The split is one undo step; the drag
  // that follows settles into a second. Returns the reconciled new node's id
  // so the scene can pick up the drag immediately.
  const beginSplitDrag = useCallback(
    (edgeId: string, point: Point): string | null => {
      const current = floorRef.current;
      const next = splitEdgeAt(current, edgeId, point);
      if (next === current) return null;
      const newNode = next.nodes.find(
        (n) => !current.nodes.some((o) => o.id === n.id),
      );
      commitFloor(activeFloorIdRef.current, () => next);
      return newNode ? newNode.id : null;
    },
    [commitFloor],
  );
  // A length pill commit: the pill supplies which end stays `fixed` (it knows
  // the wall's rendered orientation), and the far corner — plus every wall
  // sharing it — slides to the new length in one undo step.
  const setEdgeLen = useCallback(
    (edgeId: string, length: number, fixed: "a" | "b") =>
      commitFloor(activeFloorIdRef.current, (floor) =>
        setEdgeLength(floor, edgeId, length, fixed),
      ),
    [commitFloor],
  );
  const deleteNodeCmd = useCallback(
    (nodeId: string) =>
      commitFloor(activeFloorIdRef.current, (floor) =>
        deleteNode(floor, nodeId),
      ),
    [commitFloor],
  );
  const deleteEdgeCmd = useCallback(
    (edgeId: string) =>
      commitFloor(activeFloorIdRef.current, (floor) =>
        deleteEdge(floor, edgeId),
      ),
    [commitFloor],
  );

  // The "new room" escape hatch: clear down to a fresh one-floor building
  // (autosave persists the cleared state, wiping the old save) and drop into
  // draw mode with the wall tool armed to draw from scratch.
  const startNewRoom = useCallback(() => {
    if (
      !window.confirm(
        "Start a new room? The current room and its autosave will be cleared.",
      )
    ) {
      return;
    }
    const fresh = reconcileFloor(createFloor());
    setBuildingHistory((history) =>
      commitHistory(history, { floors: [fresh] }),
    );
    setActiveFloorId(fresh.id);
    setChainNode(null);
    setDrawTool("wall");
    setViewMode("draw");
  }, []);

  // ⌘Z / ⇧⌘Z (ctrl on non-mac) step the floor history in every lens — draw
  // included (Phase 9) — and keystrokes inside inputs keep their native undo.
  // Chain-end / node delete keys live in `draw-scene.tsx` (local hover state).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "z") return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redoRoom();
      else undoRoom();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoRoom, redoRoom]);

  // Keyboard editing on the selection (every lens but draw, which has no
  // furniture selection): arrows nudge by the placement grid step (shift =
  // fine 1 cm) — a key-repeat burst previews and folds into one history step
  // when the key lifts — R spins 90°, delete/backspace deletes, esc
  // deselects. Window listeners that skip inputs, exactly like the undo
  // keys; a live pointer drag suspends the whole effect (it owns the keys).
  const selectedMounted = Boolean(selectedItem?.mount);
  useEffect(() => {
    if (!selectedId || viewMode === "draw" || sceneDragActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      const step = event.shiftKey ? FINE_NUDGE_STEP : PLACEMENT_GRID;
      switch (event.key) {
        // Plan y points down, so screen-up is -y (matches the 2D lens; the
        // 3D lens keeps the same plan axes regardless of orbit).
        case "ArrowUp":
          event.preventDefault();
          nudgeSelected(0, -step);
          break;
        case "ArrowDown":
          event.preventDefault();
          nudgeSelected(0, step);
          break;
        case "ArrowLeft":
          event.preventDefault();
          nudgeSelected(-step, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          nudgeSelected(step, 0);
          break;
        case "r":
        case "R":
          // A mounted item's rotation is derived from its wall — no keyboard
          // spin, matching the inspector (it hides Rotate for mounts).
          if (!selectedMounted) rotateSelected90();
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          deleteSelected();
          break;
        case "Escape":
          // The settings popover's own esc handler wins while it's open.
          if (!settingsOpen) setSelectedId(null);
          break;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow")) settleRoom();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // Deselecting or switching lenses mid-burst still settles the previews.
      settleRoom();
    };
  }, [
    selectedId,
    selectedMounted,
    viewMode,
    sceneDragActive,
    settingsOpen,
    nudgeSelected,
    rotateSelected90,
    deleteSelected,
    settleRoom,
  ]);

  // The opening selection's keyboard: delete removes, esc deselects. Same
  // input-skipping window listener as above; furniture selection (which
  // clears the opening one) owns the richer set.
  useEffect(() => {
    if (!selectedOpeningId || selectedId || viewMode === "draw") return;
    if (sceneDragActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      switch (event.key) {
        case "Delete":
        case "Backspace":
          event.preventDefault();
          deleteSelectedOpening();
          break;
        case "Escape":
          if (!settingsOpen) setSelectedOpeningId(null);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedOpeningId,
    selectedId,
    viewMode,
    sceneDragActive,
    settingsOpen,
    deleteSelectedOpening,
  ]);

  // The wall selection's keyboard: esc deselects only (no delete — walls
  // come from the graph, not a removable item list). Same input-skipping
  // window listener as the other two, mutually exclusive with them.
  useEffect(() => {
    if (
      !selectedEdgeId ||
      selectedId ||
      selectedOpeningId ||
      viewMode === "draw"
    ) {
      return;
    }
    if (sceneDragActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      if (event.key === "Escape" && !settingsOpen) setSelectedEdgeId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedEdgeId,
    selectedId,
    selectedOpeningId,
    viewMode,
    sceneDragActive,
    settingsOpen,
  ]);

  // The stair selection's keyboard: modeled on the furniture one — arrows
  // nudge (a key-repeat burst previews and folds into one history step on
  // keyup), `r` rotates +90°, delete/backspace removes, esc deselects. Same
  // input-skipping window listener, mutually exclusive with the other three.
  useEffect(() => {
    if (
      !selectedStairId ||
      selectedId ||
      selectedOpeningId ||
      selectedEdgeId ||
      viewMode === "draw"
    ) {
      return;
    }
    if (sceneDragActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      const step = event.shiftKey ? FINE_NUDGE_STEP : PLACEMENT_GRID;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          nudgeSelectedStair(0, -step);
          break;
        case "ArrowDown":
          event.preventDefault();
          nudgeSelectedStair(0, step);
          break;
        case "ArrowLeft":
          event.preventDefault();
          nudgeSelectedStair(-step, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          nudgeSelectedStair(step, 0);
          break;
        case "r":
        case "R":
          rotateSelectedStair90();
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          deleteSelectedStair();
          break;
        case "Escape":
          if (!settingsOpen) setSelectedStairId(null);
          break;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow")) settleRoom();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // Deselecting or switching lenses mid-burst still settles the previews.
      settleRoom();
    };
  }, [
    selectedStairId,
    selectedId,
    selectedOpeningId,
    selectedEdgeId,
    viewMode,
    sceneDragActive,
    settingsOpen,
    nudgeSelectedStair,
    rotateSelectedStair90,
    deleteSelectedStair,
    settleRoom,
  ]);

  // Screen 2d, amended 2026-07-16: the library docks as its own column
  // between rail and canvas while the inspector keeps the right edge — the
  // place → tweak → place loop never has to swap panels.
  const objectsOpen = libraryOpen && viewMode !== "draw";

  // Floor chips (canvas overlay): ground-first data, labeled "G"/"2"/"3"…;
  // the component itself reverses the order so the tallest storey renders on
  // top.
  const floorChips = useMemo(
    () =>
      building.floors.map((f, index) => ({
        id: f.id,
        label: index === 0 ? "G" : String(index + 1),
        name: floorDisplayName(building, index),
      })),
    [building],
  );
  // Resolved from `floor` (the same fallback-safe lookup used everywhere
  // else: `floorById(building, activeFloorId) ?? building.floors[0]`), never
  // from `activeFloorId` directly — for one render after an undo/redo lands
  // the active id on a since-removed floor (the clamp effect corrects it a
  // tick later), `floorIndexOf(building, activeFloorId)` would return -1 and
  // `floorDisplayName(building, -1)` renders the bogus "Floor 0". Deriving
  // the index from `floor` instead always resolves to a real floor's real
  // name for that frame.
  const activeFloorIndex = building.floors.indexOf(floor);
  // Status bar prefix: only worth naming the floor out loud once there's more
  // than one.
  const activeFloorName =
    building.floors.length > 1
      ? floorDisplayName(building, activeFloorIndex)
      : null;
  // V6 ghost underlay: the storey directly below the active one, traced in
  // the 2D/draw lenses — null with the toggle off or on the ground floor
  // (nothing below it). `underlayAvailable` gates the status-bar toggle
  // itself, independent of whether it's currently switched on.
  const underlayAvailable = activeFloorIndex > 0;
  const underlayFloor =
    underlayVisible && underlayAvailable
      ? building.floors[activeFloorIndex - 1]
      : null;
  const underlayRooms = underlayFloor
    ? (derivedByFloor.get(underlayFloor.id)?.rooms ?? [])
    : [];
  // Inspector's per-floor breakdown, ground-first — reuses `derivedByFloor`
  // so no floor gets re-derived just to summarize it.
  const floorSummaries = useMemo(
    () =>
      building.floors.map((f, index) => {
        const rooms = derivedByFloor.get(f.id)?.rooms ?? [];
        const hasOutline = rooms.some((room) => room.outline.length >= 3);
        return {
          id: f.id,
          name: floorDisplayName(building, index),
          area: hasOutline ? totalFloorArea(rooms) : 0,
          roomCount: rooms.length,
          active: f.id === activeFloorId,
        };
      }),
    [building, derivedByFloor, activeFloorId],
  );
  // Settings popover's per-floor rooms (every floor, not just the active
  // one) plus the raw/display name split `SettingsPopover` renders the NAME
  // field from.
  const settingsFloors = useMemo(
    () =>
      building.floors.map((f, index) => ({
        id: f.id,
        name: f.name ?? "",
        defaultName: floorDisplayName(building, index),
        rooms: (derivedByFloor.get(f.id)?.rooms ?? []) as Room[],
      })),
    [building, derivedByFloor],
  );

  // Every floor the 3D stack renders (ground-up through the active one) —
  // the same slice `PlannerCanvas` builds its `stack` from — union-bounded
  // for the pool sizing below, so a tall building's spotlight pool covers
  // the whole visible model, not just the active storey's footprint.
  const visibleFloorsBounds = useMemo(() => {
    const activeIndex = Math.max(floorIndexOf(building, activeFloorId), 0);
    return building.floors
      .slice(0, activeIndex + 1)
      .reduce<Bounds | null>(
        (acc, f) =>
          unionBounds(acc, floorBounds(derivedByFloor.get(f.id)?.rooms ?? [])),
        null,
      );
  }, [building, activeFloorId, derivedByFloor]);
  // Studio pool sized to the whole-floor bbox: at fit zoom the model's
  // on-screen extent scales with each plan axis over the diagonal, so the
  // 3D lens's pool ellipse follows the same ratios (a wide flat gets a
  // wide, flat pool). The 70/89 factors reproduce the mockup's 54vw × 56vh
  // pool for its 6.40 × 5.20 room; absent bounds fall back to that in CSS.
  const canvasStyle = useMemo(() => {
    const style: Record<string, string> = { gridArea: "canvas" };
    const bounds = visibleFloorsBounds;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const diagonal = Math.hypot(bounds.width, bounds.height);
      const w = Math.round((70 * bounds.width) / diagonal);
      const h = Math.round((89 * bounds.height) / diagonal);
      style["--pool-w"] = `max(${w}vw, 540px)`;
      style["--pool-h"] = `max(${h}vh, 400px)`;
    }
    // Tint the 3D studio-pool gradient stops to match the hour, so the canvas
    // background shares the sun's warmth (styles.css consumes these).
    const [pool0, pool1, pool2] = LIGHTING[timeOfDay].pool;
    style["--pool-0"] = pool0;
    style["--pool-1"] = pool1;
    style["--pool-2"] = pool2;
    return style;
  }, [visibleFloorsBounds, timeOfDay]);

  return (
    // The library column animates 0 ↔ 306px (the track count stays constant
    // so grid-template-columns interpolates; `planner-grid` in styles.css
    // owns the transition). The canvas resizes undebounced every frame of
    // the flight, so the room glides instead of jumping.
    <div
      className="planner-grid grid h-screen w-screen overflow-hidden bg-[var(--frame)]"
      style={{
        gridTemplateColumns: objectsOpen
          ? "64px 306px 1fr 320px"
          : "64px 0px 1fr 320px",
        gridTemplateRows: "56px 1fr 38px",
        gridTemplateAreas:
          "'rail header header inspector' 'rail library canvas inspector' 'rail library status inspector'",
      }}
    >
      <NavRail
        activeMode={viewMode}
        onSelectMode={setViewMode}
        onFurnish={handleFurnish}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
      />
      {settingsOpen && (
        <SettingsPopover
          floors={settingsFloors}
          unit={unit}
          onRenameRoom={renameRoom}
          onRoomWallHeight={setCeilingHeight}
          onRenameFloor={renameFloorCmd}
          onDeleteFloor={deleteFloor}
          canDeleteFloor={building.floors.length > 1}
          onClose={closeSettings}
        />
      )}
      <WorkspaceHeader
        mode={viewMode}
        roomName={room?.name ?? "Untitled room"}
        savedAt={savedAt}
        onNewRoom={startNewRoom}
        onSelectMode={setViewMode}
        onUndo={undoRoom}
        onRedo={redoRoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onFullscreen={toggleFullscreen}
        placingName={placing?.item.name ?? null}
      />
      <div
        ref={workspaceRef}
        className="workspace-canvas relative min-h-0 min-w-0"
        style={canvasStyle}
        data-view-mode={viewMode}
      >
        {canvasReady && (
          <Suspense fallback={null}>
            <PlannerCanvas
              building={building}
              activeFloorId={activeFloorId}
              derivedByFloor={derivedByFloor}
              floor={floor}
              rooms={derived.rooms}
              unassignedFurniture={derived.unassignedFurniture}
              underlayFloor={underlayFloor}
              underlayRooms={underlayRooms}
              onFloorChange={setFloor}
              onFloorPreview={previewFloor}
              onRoomDragActiveChange={handleRoomDragActive}
              viewMode={viewMode}
              selectedId={selectedId}
              onSelectedIdChange={setSelectedId}
              selectedOpeningId={selectedOpeningId}
              onSelectedOpeningIdChange={setSelectedOpeningId}
              selectedEdgeId={selectedEdgeId}
              onSelectedEdgeIdChange={setSelectedEdgeId}
              selectedStairId={selectedStairId}
              onSelectedStairIdChange={setSelectedStairId}
              cameraApiRef={cameraApiRef}
              readoutStore={readoutStore}
              unit={unit}
              gridVisible={gridVisible}
              snapEnabled={snapEnabled}
              timeOfDay={timeOfDay}
              sunAnchorDeg={sunAnchorDeg}
              drawTool={drawTool}
              chainNode={chainNode}
              onExtendChain={extendChain}
              onEndChain={endChain}
              onPlaceRect={placeRect}
              onNodeMovePreview={nodeMovePreview}
              onNodeMoveSettle={nodeMoveSettle}
              onNodeMoveCancel={nodeMoveCancel}
              onBeginSplitDrag={beginSplitDrag}
              onSetEdgeLength={setEdgeLen}
              onDeleteNode={deleteNodeCmd}
              onDeleteEdge={deleteEdgeCmd}
              placingItem={placing?.item ?? null}
              onPlacingEnd={endPlacing}
            />
          </Suspense>
        )}
        {viewMode === "draw" && (
          <>
            <DrawToolStack
              tool={drawTool}
              onToolChange={handleDrawToolChange}
            />
            <DrawHintBar tool={drawTool} chaining={chainNode !== null} />
          </>
        )}
        <ZoomPill
          cameraReadout={readoutStore}
          onZoomIn={() => cameraApiRef.current?.zoomIn()}
          onZoomOut={() => cameraApiRef.current?.zoomOut()}
          onZoomToFit={() => cameraApiRef.current?.zoomToFit()}
        />
        <FloorChips
          floors={floorChips}
          activeFloorId={activeFloorId}
          onSelect={selectFloor}
          onAdd={addFloor}
        />
        {viewMode === "3d" && (
          <TimeOfDayControl
            value={timeOfDay}
            onChange={setTimeOfDay}
            sunAzimuthDeg={sunAnchorDeg + LIGHTING[timeOfDay].sun.rakeDeg}
            sunOverridden={sunAzimuthDeg != null}
            readout={readoutStore}
            onAimSun={handleAimSun}
            onResetSun={handleResetSun}
          />
        )}
        {placing && (
          <PlacementDragLayer
            item={placing.item}
            origin={placing.origin}
            onCancel={endPlacing}
          />
        )}
      </div>
      <StatusBar
        mode={viewMode}
        libraryOpen={objectsOpen}
        floorName={activeFloorName}
        rooms={derived.rooms}
        objectCount={floor.furniture.length}
        selectedRoomName={selectedRoomName}
        portalStatus={portalStatus}
        cameraReadout={readoutStore}
        unit={unit}
        onUnitChange={setUnit}
        gridVisible={gridVisible}
        onToggleGrid={() => setGridVisible((on) => !on)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((on) => !on)}
        underlayVisible={underlayVisible}
        onToggleUnderlay={() => setUnderlayVisible((on) => !on)}
        underlayAvailable={underlayAvailable}
        nodeCount={floor.nodes.length}
        placingName={placing?.item.name ?? null}
      />
      {/* Always mounted so the drawer can slide: the wrapper clips while its
          column animates, the fixed-width panel pins to the right edge so it
          emerges rather than reflows. `inert` keeps the closed drawer out of
          tab order and hit testing. */}
      <div
        className="library-drawer relative min-h-0 overflow-hidden"
        style={{ gridArea: "library" }}
        data-open={objectsOpen}
        inert={!objectsOpen}
      >
        <div className="absolute inset-y-0 right-0 w-[306px]">
          <ObjectsPanel
            placingId={placing?.item.id ?? null}
            stairsEnabled={
              floorIndexOf(building, activeFloorId) < building.floors.length - 1
            }
            onStartPlacing={startPlacing}
            onClose={() => setLibraryOpen(false)}
          />
        </div>
      </div>
      <Inspector
        rooms={derived.rooms}
        floorSummaries={floorSummaries}
        unit={unit}
        mode={viewMode}
        selectedItem={selectedItem}
        selectedRoomName={selectedRoomName}
        selectedHostName={selectedHostName}
        selectedWallHeight={selectedWallHeight}
        selectedOpening={selectedOpening}
        selectedWall={selectedWall}
        selectedStair={selectedStair}
        nodeCount={floor.nodes.length}
        openingCount={derived.rooms[0]?.openingCount ?? 0}
        onResize={resizeSelected}
        onRotateTo={rotateSelectedTo}
        onElevate={elevateSelected}
        onMoveTo={moveSelectedTo}
        onRecolor={recolorSelected}
        onRotate90={rotateSelected90}
        onClone={cloneSelected}
        onOpeningResize={resizeSelectedOpening}
        onOpeningVerticals={setSelectedOpeningVerticals}
        onOpeningShift={shiftSelectedOpening}
        onOpeningFlipHinge={flipSelectedOpeningHinge}
        onOpeningFlipSide={flipSelectedOpeningSide}
        onOpeningSillOverhang={setSelectedOpeningSillOverhang}
        onOpeningSillMaterial={setSelectedOpeningSillMaterial}
        onOpeningDelete={deleteSelectedOpening}
        onWallThickness={setWallThickness}
        onStairResize={resizeSelectedStair}
        onStairRotateTo={rotateSelectedStairTo}
        onStairMoveTo={moveSelectedStairTo}
        onStairDelete={deleteSelectedStair}
        onDelete={deleteSelected}
      />
    </div>
  );
}
