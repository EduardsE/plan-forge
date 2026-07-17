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
import { Inspector } from "#/components/inspector";
import { NavRail } from "#/components/nav-rail";
import { ObjectsPanel } from "#/components/objects-panel";
import { PlacementDragLayer } from "#/components/placement-drag-layer";
import { SettingsPopover } from "#/components/settings-popover";
import { StatusBar } from "#/components/status-bar";
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
import {
  allFurnitureOf,
  type CatalogItem,
  createSampleFloor,
  DEFAULT_WALL_HEIGHT,
  deriveFloor,
  duplicateFurniture,
  edgeCeiling,
  type Floor,
  type Footprint,
  flipFloorOpeningHinge,
  flipFloorOpeningSide,
  floorBounds,
  furnitureDisplayName,
  openingVerticals,
  type Point,
  portalLabel,
  type Room,
  reconcileFloor,
  removeFloorOpening,
  removeFurniture,
  resizeFloorOpening,
  roomOfFurniture,
  rotateFurniture,
  setFurnitureColorway,
  setFurnitureFootprint,
  setFurnitureRotation,
  setMountElevation,
  setOpeningVerticals,
  setRoomName,
  setRoomWallHeight,
  updateDerivedRoom,
  updateFloorFurniture,
  updateFurniture,
  wallHeightOf,
} from "#/lib/model";
import {
  deserializeSavedState,
  STORAGE_KEY,
  serializeSavedState,
} from "#/lib/persistence";
import { edgeWallObstacles, type Obstacle, PLACEMENT_GRID } from "#/lib/place";
import type { Unit } from "#/lib/units";
import type { ViewMode } from "#/lib/view-mode";

/** Shift-arrow nudge step, meters — the "fine" 1 cm move. */
const FINE_NUDGE_STEP = 0.01;

/** A fresh, empty graph floor — the "New room" reset target. */
function emptyFloor(): Floor {
  return { nodes: [], edges: [], openings: [], furniture: [], rooms: [] };
}

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
  // The floor lives inside a bounded undo/redo history. Discrete mutations
  // (add/rotate/duplicate/delete, opening edits, outline close) go through
  // `setRoom` = one undo step each; the continuous drags stream through
  // `previewRoom` and fold into a single step when `settleRoom` fires at
  // gesture end — an esc-cancelled drag leaves no step at all.
  const [floorHistory, setFloorHistory] = useState(() =>
    createHistory(createSampleFloor()),
  );
  const floor = floorHistory.current;
  // Live floor for handlers that must compute a graph edit *and* read its
  // result synchronously (chain extend / split-then-drag both need the id the
  // reconcile minted before the state update flushes).
  const floorRef = useRef(floor);
  floorRef.current = floor;
  // Rooms are *derived* from the graph (`deriveFloor`): scenes, readouts, and
  // every per-room edit speak this `Room[]` view; the graph `Floor` is what
  // history/persistence hold. Recomputed on each floor change.
  const derived = useMemo(() => deriveFloor(floor), [floor]);
  // The first derived room anchors the header breadcrumb; everything
  // selection-shaped resolves its owning room from the item id instead.
  const room = derived.rooms[0] as Room | undefined;
  // Whole-floor commits ("New room", draw mode's edits, opening edits). One
  // undo step; a same-reference no-op lands nowhere.
  const setFloor = useCallback((next: Floor) => {
    setFloorHistory((history) =>
      next === history.current ? history : commitHistory(history, next),
    );
  }, []);
  // A mid-drag whole-floor state (an opening slide): a preview like a
  // furniture drag's, folded into one step when the drag settles.
  const previewFloor = useCallback(
    (next: Floor) =>
      setFloorHistory((history) => previewHistory(history, next)),
    [],
  );
  // One derived room's discrete mutation, addressed by id — one undo step.
  // `updateDerivedRoom` runs the edit back through the graph and keeps the
  // pure setters' no-op contract at floor level (a same-reference room yields
  // the same floor, which must not become an empty undo step).
  const commitToRoom = useCallback(
    (targetId: string, update: (room: Room) => Room) => {
      setFloorHistory((history) => {
        const value = updateDerivedRoom(
          history.current,
          deriveFloor(history.current),
          targetId,
          update,
        );
        return value === history.current
          ? history
          : commitHistory(history, value);
      });
    },
    [],
  );
  const settleRoom = useCallback(() => setFloorHistory(settleHistory), []);
  const undoRoom = useCallback(() => setFloorHistory(undoHistory), []);
  const redoRoom = useCallback(() => setFloorHistory(redoHistory), []);
  // Draw edits the graph live (Phase 9) — undo/redo stay active in draw mode,
  // like every other lens.
  const canUndo = floorHistory.past.length > 0;
  const canRedo = floorHistory.future.length > 0;
  const [unit, setUnit] = useState<Unit>("m");
  // The furniture selection is route state so the inspector (outside the
  // canvas) and the in-scene picking/label share one selection. The canvas
  // keeps opening selection internal and clears this one when it takes over.
  // Selection is floor-wide: the item is found across every room plus the
  // unassigned (open-canvas) bucket, and its room membership is a readout.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const allFurniture = useMemo(
    () => allFurnitureOf(derived.rooms, derived.unassignedFurniture),
    [derived],
  );
  const selectedItem = selectedId
    ? (allFurniture.find((item) => item.id === selectedId) ?? null)
    : null;
  const selectedRoom = selectedId
    ? (roomOfFurniture(derived.rooms, selectedId) ?? null)
    : null;
  const multiRoom = derived.rooms.length > 1;
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
          allFurniture.find((f) => f.id === selectedItem.stack?.hostId)
            ?.catalogId ?? "",
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
  // Everything the inspector's opening view needs, resolved once: effective
  // verticals, the host edge's ceiling, the portal label, whether the wall
  // borders two rooms. Openings are editable in both furnish lenses.
  const selectedOpening = useMemo(() => {
    if (!selectedOpeningId || viewMode === "draw") return null;
    const opening = floor.openings.find((o) => o.id === selectedOpeningId);
    if (!opening) return null;
    const { bottom, top } = openingVerticals(opening);
    return {
      opening,
      bottom,
      top,
      ceiling: edgeCeiling(derived.rooms, opening.edgeId),
      connects: portalLabel(derived.rooms, floor, opening.id),
      twoFace:
        derived.rooms.filter((r) =>
          r.wallRefs.some((ref) => ref.edgeId === opening.edgeId),
        ).length === 2,
    };
  }, [selectedOpeningId, viewMode, derived, floor]);
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
      setFloor(resizeFloorOpening(floorRef.current, selectedOpeningId, width));
    },
    [selectedOpeningId, setFloor],
  );
  const setSelectedOpeningVerticals = useCallback(
    (verticals: { bottom?: number; top?: number }) => {
      if (!selectedOpening) return;
      setFloor(
        setOpeningVerticals(
          floorRef.current,
          selectedOpening.opening.id,
          verticals,
          selectedOpening.ceiling,
        ),
      );
    },
    [selectedOpening, setFloor],
  );
  const flipSelectedOpeningHinge = useCallback(() => {
    if (!selectedOpeningId) return;
    setFloor(flipFloorOpeningHinge(floorRef.current, selectedOpeningId));
  }, [selectedOpeningId, setFloor]);
  const flipSelectedOpeningSide = useCallback(() => {
    if (!selectedOpeningId) return;
    setFloor(flipFloorOpeningSide(floorRef.current, selectedOpeningId));
  }, [selectedOpeningId, setFloor]);
  const deleteSelectedOpening = useCallback(() => {
    if (!selectedOpeningId) return;
    setFloor(removeFloorOpening(floorRef.current, selectedOpeningId));
    setSelectedOpeningId(null);
  }, [selectedOpeningId, setFloor]);
  // One floor-level furniture commit: the pure setter runs over the whole
  // floor's furniture (`updateFloorFurniture`), re-contained against the wall
  // slabs — furniture is floor-level now, so an item may sit in any room, the
  // dead band at a shared wall, or the open canvas, bounded only by the walls.
  // One history step; a same-reference no-op lands nowhere.
  const mutateFurniture = useCallback(
    (fn: (room: Room, wallObstacles: Obstacle[]) => Room) => {
      setFloorHistory((history) => {
        const floor = history.current;
        const wallObstacles = edgeWallObstacles(floor);
        const value = updateFloorFurniture(floor, (room) =>
          fn(room, wallObstacles),
        );
        return value === floor ? history : commitHistory(history, value);
      });
    },
    [],
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
      setFloorHistory((history) => {
        const floor = history.current;
        const wallObstacles = edgeWallObstacles(floor);
        const next = updateFloorFurniture(floor, (room) =>
          nudgeFurniture(wallObstacles, room, selectedId, dx, dy),
        );
        return next === floor ? history : previewHistory(history, next);
      });
    },
    [selectedId],
  );
  // The Settings rail button's popover: per-room name + ceiling height, each
  // commit one history step through the pure room setters (no-ops return the
  // same reference and land nowhere).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = useCallback(() => setSettingsOpen((on) => !on), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const renameRoom = useCallback(
    (targetId: string, name: string) =>
      commitToRoom(targetId, (current) => setRoomName(current, name)),
    [commitToRoom],
  );
  const setCeilingHeight = useCallback(
    (targetId: string, meters: number) =>
      commitToRoom(targetId, (current) => setRoomWallHeight(current, meters)),
    [commitToRoom],
  );
  // Bottom-left view toggles. Grid shows the in-scene reference grid; snap
  // gates draw/placement quantize + flush snapping. Both default on, matching
  // the lit state the mockups show.
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
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
  // localStorage only exists on the client), then write back on every floor
  // or unit change. `lastSavedRef` holds the last payload written or loaded,
  // so hydration itself doesn't count as a save and reloads keep the honest
  // saved-at time instead of resetting the clock to "just now". Older payload
  // versions can't be reconstructed as a wall graph, so a stale or malformed
  // save is discarded (hydrates as the sample floor) — no migration.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    const saved = deserializeSavedState(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      // Hydration replaces the pre-mount sample floor outright — resetting
      // history keeps it out of the undo stack.
      setFloorHistory(createHistory(saved.floor));
      setUnit(saved.unit);
      setSavedAt(saved.savedAt);
      lastSavedRef.current = JSON.stringify({
        floor: saved.floor,
        unit: saved.unit,
      });
    }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    const payload = JSON.stringify({ floor, unit });
    if (payload === lastSavedRef.current) return;
    lastSavedRef.current = payload;
    const now = Date.now();
    localStorage.setItem(
      STORAGE_KEY,
      serializeSavedState({ floor, unit, savedAt: now }),
    );
    setSavedAt(now);
  }, [storageReady, floor, unit]);

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
  const extendChain = useCallback((from: Point, to: Point) => {
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
    setFloorHistory((history) =>
      next === history.current ? history : commitHistory(history, next),
    );
    setChainNode(landed);
  }, []);
  const endChain = useCallback(() => setChainNode(null), []);
  // Rect tool: compose the four walls into ONE floor value → one undo step,
  // then hand off to Select (drag corners / edit lengths like any wall).
  const placeRect = useCallback((a: Point, b: Point) => {
    const corners = rectangleOutline(a, b);
    if (!corners) return;
    setFloorHistory((history) => {
      let f = history.current;
      for (let i = 0; i < 4; i++) {
        f = addWallSegment(f, corners[i], corners[(i + 1) % 4]);
      }
      return f === history.current ? history : commitHistory(history, f);
    });
    setDrawTool("select");
  }, []);
  // A node drag: previews stream (raw, no weld mid-gesture), the release
  // settles into one step (welds fire in `settleNodeMove`), esc restores the
  // node to where the drag began (no step at all).
  const nodeMovePreview = useCallback(
    (nodeId: string, point: Point) =>
      setFloorHistory((history) =>
        previewHistory(
          history,
          moveNodePreview(history.current, nodeId, point),
        ),
      ),
    [],
  );
  const nodeMoveSettle = useCallback(
    (nodeId: string, point: Point) =>
      setFloorHistory((history) =>
        settleHistory(
          previewHistory(
            history,
            settleNodeMove(history.current, nodeId, point),
          ),
        ),
      ),
    [],
  );
  const nodeMoveCancel = useCallback(
    (nodeId: string, original: Point) =>
      setFloorHistory((history) =>
        settleHistory(
          previewHistory(
            history,
            moveNodePreview(history.current, nodeId, original),
          ),
        ),
      ),
    [],
  );
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
      setFloorHistory((history) =>
        next === history.current ? history : commitHistory(history, next),
      );
      return newNode ? newNode.id : null;
    },
    [],
  );
  // A length pill commit: the pill supplies which end stays `fixed` (it knows
  // the wall's rendered orientation), and the far corner — plus every wall
  // sharing it — slides to the new length in one undo step.
  const setEdgeLen = useCallback(
    (edgeId: string, length: number, fixed: "a" | "b") =>
      setFloorHistory((history) => {
        const next = setEdgeLength(history.current, edgeId, length, fixed);
        return next === history.current
          ? history
          : commitHistory(history, next);
      }),
    [],
  );
  const deleteNodeCmd = useCallback(
    (nodeId: string) =>
      setFloorHistory((history) => {
        const next = deleteNode(history.current, nodeId);
        return next === history.current
          ? history
          : commitHistory(history, next);
      }),
    [],
  );
  const deleteEdgeCmd = useCallback(
    (edgeId: string) =>
      setFloorHistory((history) => {
        const next = deleteEdge(history.current, edgeId);
        return next === history.current
          ? history
          : commitHistory(history, next);
      }),
    [],
  );

  // The "new room" escape hatch: clear the floor down to an empty graph
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
    setFloor(reconcileFloor(emptyFloor()));
    setChainNode(null);
    setDrawTool("wall");
    setViewMode("draw");
  }, [setFloor]);

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

  // Screen 2d, amended 2026-07-16: the library docks as its own column
  // between rail and canvas while the inspector keeps the right edge — the
  // place → tweak → place loop never has to swap panels.
  const objectsOpen = libraryOpen && viewMode !== "draw";

  // Studio pool sized to the whole-floor bbox: at fit zoom the model's
  // on-screen extent scales with each plan axis over the diagonal, so the
  // 3D lens's pool ellipse follows the same ratios (a wide flat gets a
  // wide, flat pool). The 70/89 factors reproduce the mockup's 54vw × 56vh
  // pool for its 6.40 × 5.20 room; absent bounds fall back to that in CSS.
  const canvasStyle = useMemo(() => {
    const style: Record<string, string> = { gridArea: "canvas" };
    const bounds = floorBounds(derived.rooms);
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const diagonal = Math.hypot(bounds.width, bounds.height);
      const w = Math.round((70 * bounds.width) / diagonal);
      const h = Math.round((89 * bounds.height) / diagonal);
      style["--pool-w"] = `max(${w}vw, 540px)`;
      style["--pool-h"] = `max(${h}vh, 400px)`;
    }
    return style;
  }, [derived.rooms]);

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
          rooms={derived.rooms}
          unit={unit}
          onRename={renameRoom}
          onWallHeightChange={setCeilingHeight}
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
              floor={floor}
              rooms={derived.rooms}
              unassignedFurniture={derived.unassignedFurniture}
              onFloorChange={setFloor}
              onFloorPreview={previewFloor}
              onRoomDragActiveChange={handleRoomDragActive}
              viewMode={viewMode}
              selectedId={selectedId}
              onSelectedIdChange={setSelectedId}
              selectedOpeningId={selectedOpeningId}
              onSelectedOpeningIdChange={setSelectedOpeningId}
              cameraApiRef={cameraApiRef}
              readoutStore={readoutStore}
              unit={unit}
              gridVisible={gridVisible}
              snapEnabled={snapEnabled}
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
            onStartPlacing={startPlacing}
            onClose={() => setLibraryOpen(false)}
          />
        </div>
      </div>
      <Inspector
        rooms={derived.rooms}
        unit={unit}
        mode={viewMode}
        selectedItem={selectedItem}
        selectedRoomName={selectedRoomName}
        selectedHostName={selectedHostName}
        selectedWallHeight={selectedWallHeight}
        selectedOpening={selectedOpening}
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
        onOpeningFlipHinge={flipSelectedOpeningHinge}
        onOpeningFlipSide={flipSelectedOpeningSide}
        onOpeningDelete={deleteSelectedOpening}
        onDelete={deleteSelected}
      />
    </div>
  );
}
