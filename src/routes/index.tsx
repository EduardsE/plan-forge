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
import { OpeningToolStack } from "#/components/opening-tool-stack";
import { PlacementDragLayer } from "#/components/placement-drag-layer";
import { SettingsPopover } from "#/components/settings-popover";
import { StatusBar } from "#/components/status-bar";
import { WorkspaceHeader } from "#/components/workspace-header";
import { ZoomPill } from "#/components/zoom-pill";
import { type CameraApi, createCameraReadoutStore } from "#/lib/camera";
import { containRoomFurniture, nudgeFurniture } from "#/lib/collision";
import { rectangleOutline, setSegmentLength } from "#/lib/draw";
import {
  commitHistory,
  createHistory,
  previewHistory,
  redoHistory,
  settleHistory,
  undoHistory,
} from "#/lib/history";
import {
  addRoom,
  type CatalogItem,
  createSampleFloor,
  duplicateFurniture,
  type Floor,
  type Footprint,
  floorBounds,
  nextRoomName,
  type OpeningKind,
  type Point,
  type Room,
  removeFurniture,
  roomById,
  roomOfFurniture,
  rotateFurniture,
  setFurnitureColorway,
  setFurnitureFootprint,
  setFurnitureRotation,
  setMountElevation,
  setRoomName,
  setRoomWallHeight,
  updateFurniture,
  updateRoomIn,
} from "#/lib/model";
import {
  applyOutlineDraft,
  draftFromRoom,
  emptyOutlineDraft,
  type OutlineDraft,
  removeOutlineCorner,
  sameOutline,
  setClosedSegmentLength,
  splitOutlineWall,
} from "#/lib/outline-edit";
import {
  deserializeSavedState,
  STORAGE_KEY,
  serializeSavedState,
} from "#/lib/persistence";
import { PLACEMENT_GRID } from "#/lib/place";
import { floorPortals, portalLabel } from "#/lib/seams";
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
  // The floor lives inside a bounded undo/redo history. Discrete mutations
  // (add/rotate/duplicate/delete, opening edits, outline close) go through
  // `setRoom` = one undo step each; the continuous drags stream through
  // `previewRoom` and fold into a single step when `settleRoom` fires at
  // gesture end — an esc-cancelled drag leaves no step at all.
  const [floorHistory, setFloorHistory] = useState(() =>
    createHistory(createSampleFloor()),
  );
  const floor = floorHistory.current;
  // The floor's first room still anchors the header breadcrumb (the "Loft
  // apartment / room" line stays single-name until projects exist).
  // Everything selection-shaped resolves its owning room from the item id
  // instead (floor-wide, no active-room mode), and the draw draft carries
  // the id of the room it edits.
  const room = floor.rooms[0];
  // Whole-floor commits ("New room" and draw mode's "add room").
  const setFloor = useCallback((next: Floor) => {
    setFloorHistory((history) =>
      next === history.current ? history : commitHistory(history, next),
    );
  }, []);
  // One room's discrete mutation, addressed by id — one undo step.
  // `updateRoomIn` keeps the pure setters' no-op contract at floor level: a
  // same-reference room yields the same floor, which must not become an
  // empty undo step (or clear the redo stack).
  const commitToRoom = useCallback(
    (targetId: string, update: (room: Room) => Room) => {
      setFloorHistory((history) => {
        const value = updateRoomIn(history.current, targetId, update);
        return value === history.current
          ? history
          : commitHistory(history, value);
      });
    },
    [],
  );
  const commitRoom = useCallback(
    (targetId: string, next: Room) => commitToRoom(targetId, () => next),
    [commitToRoom],
  );
  const previewRoom = useCallback(
    (targetId: string, next: Room) =>
      setFloorHistory((history) =>
        previewHistory(
          history,
          updateRoomIn(history.current, targetId, () => next),
        ),
      ),
    [],
  );
  // A mid-drag state touching more than one room — a furniture drag
  // reparenting its item across a seam. Streams like `previewRoom`.
  const previewFloor = useCallback(
    (next: Floor) =>
      setFloorHistory((history) => previewHistory(history, next)),
    [],
  );
  const settleRoom = useCallback(() => setFloorHistory(settleHistory), []);
  const undoRoom = useCallback(() => setFloorHistory(undoHistory), []);
  const redoRoom = useCallback(() => setFloorHistory(redoHistory), []);
  // Draw mode edits the draft, not the room — floor history sits it out
  // (undoing the floor underneath a seeded draft would silently desync them).
  const historyActive = viewMode !== "draw";
  const canUndo = historyActive && floorHistory.past.length > 0;
  const canRedo = historyActive && floorHistory.future.length > 0;
  const [unit, setUnit] = useState<Unit>("m");
  // The furniture selection is route state so the inspector (outside the
  // canvas) and the in-scene picking/label share one selection. The canvas
  // keeps opening selection internal and clears this one when it takes over.
  // Selection is floor-wide: the owning room is derived from the item id.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRoom = selectedId
    ? (roomOfFurniture(floor, selectedId) ?? null)
    : null;
  const selectedItem =
    selectedRoom?.furniture.find((item) => item.id === selectedId) ?? null;
  // The opening selection (2D lens) lives here too, so the status bar and
  // inspector can label a portal — an opening on a wall two rooms share —
  // with the connection it makes. Derived from geometry, never stored.
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    null,
  );
  const portalStatus = useMemo(() => {
    if (!selectedOpeningId || viewMode !== "2d") return null;
    const owner = floor.rooms.find((entry) =>
      entry.openings.some((opening) => opening.id === selectedOpeningId),
    );
    const opening = owner?.openings.find(
      (entry) => entry.id === selectedOpeningId,
    );
    if (!opening) return null;
    const label = portalLabel(
      floor.rooms,
      floorPortals(floor.rooms),
      selectedOpeningId,
    );
    if (!label) return null;
    return `${opening.kind === "door" ? "Door" : "Window"} connects ${label}`;
  }, [selectedOpeningId, viewMode, floor]);
  // One commit against the room owning `itemId`, resolved inside the
  // functional update so bursts never work from a stale floor. One history
  // step per commit; same-reference no-ops land nowhere.
  const mutateRoomOf = useCallback(
    (itemId: string, update: (owner: Room) => Room) => {
      setFloorHistory((history) => {
        const owner = roomOfFurniture(history.current, itemId);
        if (!owner) return history;
        const value = updateRoomIn(history.current, owner.id, update);
        return value === history.current
          ? history
          : commitHistory(history, value);
      });
    },
    [],
  );
  // Inspector commits: one history step each. The pure setters return the
  // room unchanged (same reference) for no-ops, which must not become empty
  // undo steps. Rotations/resizes re-contain the item so it can't poke out.
  const rotateSelected90 = useCallback(() => {
    if (!selectedId) return;
    mutateRoomOf(selectedId, (current) =>
      containRoomFurniture(
        rotateFurniture(current, selectedId, 90),
        selectedId,
      ),
    );
  }, [selectedId, mutateRoomOf]);
  const cloneSelected = useCallback(() => {
    if (!selectedId) return;
    const newId = crypto.randomUUID();
    mutateRoomOf(selectedId, (current) =>
      containRoomFurniture(
        duplicateFurniture(current, selectedId, newId),
        newId,
      ),
    );
    // Selection follows the copy, like a drop.
    setSelectedId(newId);
  }, [selectedId, mutateRoomOf]);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    mutateRoomOf(selectedId, (current) => removeFurniture(current, selectedId));
    setSelectedId(null);
  }, [selectedId, mutateRoomOf]);
  const resizeSelected = useCallback(
    (footprint: Footprint) => {
      if (!selectedId) return;
      mutateRoomOf(selectedId, (current) => {
        const next = setFurnitureFootprint(current, selectedId, footprint);
        return next === current
          ? current
          : containRoomFurniture(next, selectedId);
      });
    },
    [selectedId, mutateRoomOf],
  );
  const rotateSelectedTo = useCallback(
    (deg: number) => {
      if (!selectedId) return;
      mutateRoomOf(selectedId, (current) => {
        const next = setFurnitureRotation(current, selectedId, deg);
        return next === current
          ? current
          : containRoomFurniture(next, selectedId);
      });
    },
    [selectedId, mutateRoomOf],
  );
  const elevateSelected = useCallback(
    (elevation: number) => {
      if (!selectedId) return;
      mutateRoomOf(selectedId, (current) =>
        setMountElevation(current, selectedId, elevation),
      );
    },
    [selectedId, mutateRoomOf],
  );
  const moveSelectedTo = useCallback(
    (position: Point) => {
      if (!selectedId) return;
      mutateRoomOf(selectedId, (current) =>
        containRoomFurniture(
          updateFurniture(current, selectedId, { position }),
          selectedId,
        ),
      );
    },
    [selectedId, mutateRoomOf],
  );
  const recolorSelected = useCallback(
    (colorway: string | null) => {
      if (!selectedId) return;
      mutateRoomOf(selectedId, (current) =>
        setFurnitureColorway(current, selectedId, colorway),
      );
    },
    [selectedId, mutateRoomOf],
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
  // room. `nudgeFurniture` owns the semantics: containment inside the
  // outline, mounts pass through, riders re-anchor on their host.
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selectedId) return;
      setFloorHistory((history) => {
        const owner = roomOfFurniture(history.current, selectedId);
        if (!owner) return history;
        const next = updateRoomIn(history.current, owner.id, (current) =>
          nudgeFurniture(current, selectedId, dx, dy),
        );
        return next === history.current
          ? history
          : previewHistory(history, next);
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
  // saved-at time instead of resetting the clock to "just now". A legacy
  // single-room save hydrates as a migrated one-room floor and stays on disk
  // in its old shape until the first real change writes v4.
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

  // The draw-mode draft outline. Owned here (not by the canvas) so the
  // header's status line can count corners and committing can become the
  // room. The draft carries the id of the floor room it edits; a null id
  // means committing *adds* a new room to the floor (the wall/rect tools).
  // Entering draw mode reopens the first room's outline as a *closed*
  // editable draft ("Draw" starts as "edit this room" — clicking another
  // room re-targets the session); only an empty outline — right after New
  // room — starts the open from-scratch draft. Leaving draw mode applies a
  // closed draft, so lens switches never lose edits; esc reverts it instead.
  const [draft, setDraft] = useState(() => emptyOutlineDraft());
  const [drawTool, setDrawTool] = useState<DrawTool>("wall");
  // Commit a finished draft: reshape its room, or — for a new-room draft —
  // append a Room to the floor. One history step either way; reshapes that
  // didn't change the outline land nowhere.
  const applyDraft = useCallback((finished: OutlineDraft) => {
    if (finished.corners.length < 3) return;
    const targetId = finished.roomId;
    if (targetId !== null) {
      setFloorHistory((history) => {
        const value = updateRoomIn(history.current, targetId, (current) =>
          sameOutline(finished.corners, current.outline)
            ? current
            : applyOutlineDraft(current, finished.corners, finished.openings),
        );
        return value === history.current
          ? history
          : commitHistory(history, value);
      });
    } else {
      setFloorHistory((history) =>
        commitHistory(
          history,
          addRoom(history.current, {
            id: crypto.randomUUID(),
            name: nextRoomName(history.current),
            outline: finished.corners,
            openings: finished.openings,
            furniture: [],
          }),
        ),
      );
    }
  }, []);
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (prev === viewMode) return;
    prevViewModeRef.current = viewMode;
    if (viewMode === "draw") {
      // Seed from the first room; an in-progress draft (fresh corners mid
      // new-room drawing) survives the round trip through another lens. The
      // tool follows the seed: a closed draft reshapes (Select), an empty
      // room draws from scratch (Wall).
      if (draft.corners.length === 0) {
        const seeded = draftFromRoom(room);
        setDraft(seeded);
        setDrawTool(seeded.closed ? "select" : "wall");
      }
    } else if (prev === "draw" && draft.closed) {
      applyDraft(draft);
      setDraft(emptyOutlineDraft());
    }
  }, [viewMode, room, draft, applyDraft]);
  // Wall/rect are *add-room* tools: picking one over a reshape session
  // applies the session first (switching tools never silently loses edits)
  // and starts a fresh new-room draft.
  const handleDrawToolChange = useCallback(
    (tool: DrawTool) => {
      if (tool !== "select" && draft.closed) {
        applyDraft(draft);
        setDraft(emptyOutlineDraft());
      }
      setDrawTool(tool);
    },
    [draft, applyDraft],
  );
  // Clicking another room in draw mode re-targets the session onto it,
  // applying whatever the current draft holds first.
  const activateDraftRoom = useCallback(
    (targetId: string) => {
      if (targetId === draft.roomId) return;
      const target = roomById(floor, targetId);
      if (!target) return;
      if (draft.closed) applyDraft(draft);
      setDraft(draftFromRoom(target));
      setDrawTool("select");
    },
    [floor, draft, applyDraft],
  );

  // The 2D lens's armed door/window tool. Owned here (like drawTool) so the
  // tool stack chrome and the header status line share it with the canvas.
  const [openingTool, setOpeningTool] = useState<OpeningKind | null>(null);
  const disarmOpeningTool = useCallback(() => setOpeningTool(null), []);
  // Leaving the 2D lens drops the armed tool with it.
  useEffect(() => {
    if (viewMode !== "2d") setOpeningTool(null);
  }, [viewMode]);
  // Esc disarms without inserting.
  useEffect(() => {
    if (viewMode !== "2d" || openingTool === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpeningTool(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, openingTool]);

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
  // Leaving objects mode mid-drag (Escape only cancels the drag) drops the
  // session with it.
  useEffect(() => {
    if (viewMode !== "objects") setPlacing(null);
  }, [viewMode]);

  const placeCorner = useCallback(
    (point: Point) =>
      setDraft((current) =>
        current.closed
          ? current
          : { ...current, corners: [...current.corners, point] },
      ),
    [],
  );
  // The rect tool's two clicks: close the draft as a fresh rectangle and
  // hand off to Select so its corners drag / lengths edit like any closed
  // draft. The draft's target rides along — a new-room rect commits as a new
  // room, the New-room flow's rect fills its empty room.
  const placeRect = useCallback((a: Point, b: Point) => {
    const corners = rectangleOutline(a, b);
    if (!corners) return;
    setDraft((current) => ({
      roomId: current.roomId,
      corners,
      closed: true,
      openings: [],
    }));
    setDrawTool("select");
  }, []);
  const setDraftSegmentLength = useCallback(
    (segmentIndex: number, meters: number) =>
      setDraft((current) => ({
        ...current,
        corners: current.closed
          ? setClosedSegmentLength(current.corners, segmentIndex, meters)
          : setSegmentLength(current.corners, segmentIndex, meters),
      })),
    [],
  );
  const moveDraftCorner = useCallback(
    (index: number, point: Point) =>
      setDraft((current) =>
        index < current.corners.length
          ? {
              ...current,
              corners: current.corners.map((corner, i) =>
                i === index ? point : corner,
              ),
            }
          : current,
      ),
    [],
  );
  const splitDraftWall = useCallback(
    (wallIndex: number, point: Point) =>
      setDraft((current) => {
        if (!current.closed) return current;
        const split = splitOutlineWall(
          current.corners,
          current.openings,
          wallIndex,
          point,
        );
        return {
          ...current,
          corners: split.outline,
          openings: split.openings,
        };
      }),
    [],
  );
  const deleteDraftCorner = useCallback(
    (index: number) =>
      setDraft((current) => {
        if (!current.closed) return current;
        const removed = removeOutlineCorner(
          current.corners,
          current.openings,
          index,
        );
        return removed.outline === current.corners
          ? current
          : {
              ...current,
              corners: removed.outline,
              openings: removed.openings,
            };
      }),
    [],
  );
  // A wall/grid click in draw mode's select state: apply the reshape
  // session (like picking the Wall tool — clicks never silently lose
  // edits) and open a fresh new-room chain with its first corner at the
  // clicked point. A stray click in select mode over an open chain just
  // places the corner, as the wall tool would.
  const startDrawAt = useCallback(
    (point: Point) => {
      if (draft.closed) {
        applyDraft(draft);
        setDraft({
          roomId: null,
          corners: [point],
          closed: false,
          openings: [],
        });
      } else {
        setDraft({ ...draft, corners: [...draft.corners, point] });
      }
      setDrawTool("wall");
    },
    [draft, applyDraft],
  );
  // ⏎ (or clicking the start corner while drawing) commits the draft: the
  // outline becomes its room — or a brand-new room — openings re-anchor to
  // their (possibly resized or split) walls, and furniture stays wherever it
  // still fits inside.
  const closeDraft = useCallback(() => {
    if (draft.corners.length < 3) return;
    applyDraft(draft);
    setDraft(emptyOutlineDraft());
    setViewMode("2d");
  }, [draft, applyDraft]);
  // Esc reverts an edit session to its room as it stands; a fresh open
  // draft (or an uncommitted new-room rectangle) just clears, keeping its
  // target.
  const cancelDraft = useCallback(
    () =>
      setDraft((current) => {
        if (current.closed && current.roomId !== null) {
          const target = roomById(floor, current.roomId);
          if (target) return draftFromRoom(target);
        }
        return emptyOutlineDraft(current.roomId);
      }),
    [floor],
  );

  // The "new room" escape hatch: clear the floor down to one fresh empty
  // room (autosave persists the cleared state, wiping the old save) and
  // start over in draw mode.
  const startNewRoom = useCallback(() => {
    if (
      !window.confirm(
        "Start a new room? The current room and its autosave will be cleared.",
      )
    ) {
      return;
    }
    const freshId = crypto.randomUUID();
    setFloor({
      rooms: [
        {
          id: freshId,
          name: "Untitled room",
          outline: [],
          openings: [],
          furniture: [],
        },
      ],
    });
    // Target the fresh room directly — when "New" is clicked from inside
    // draw mode the enter-draw seeding effect won't fire again.
    setDraft(emptyOutlineDraft(freshId));
    setDrawTool("wall");
    setViewMode("draw");
  }, [setFloor]);

  // ⏎ commits the draft into the room model, esc cancels it (reverting an
  // edit session) — unless the keystroke belongs to the inline length input
  // (or a corner drag, which swallows both in its capture-phase handler).
  useEffect(() => {
    if (viewMode !== "draw") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      ) {
        return;
      }
      if (event.key === "Enter") closeDraft();
      else if (event.key === "Escape") cancelDraft();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, closeDraft, cancelDraft]);

  // ⌘Z / ⇧⌘Z (ctrl on non-mac) step the room history, everywhere history is
  // live — draw mode sits out (see `historyActive`), and keystrokes inside
  // inputs keep their native undo.
  useEffect(() => {
    if (!historyActive) return;
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
  }, [historyActive, undoRoom, redoRoom]);

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

  // Screen 2d: in objects mode the library docks as its own column between
  // rail and canvas, and the inspector yields the right edge to give the
  // canvas room (the header spans across instead).
  const objectsOpen = viewMode === "objects";

  // Studio pool sized to the whole-floor bbox: at fit zoom the model's
  // on-screen extent scales with each plan axis over the diagonal, so the
  // 3D lens's pool ellipse follows the same ratios (a wide flat gets a
  // wide, flat pool). The 70/89 factors reproduce the mockup's 54vw × 56vh
  // pool for its 6.40 × 5.20 room; absent bounds fall back to that in CSS.
  const canvasStyle = useMemo(() => {
    const style: Record<string, string> = { gridArea: "canvas" };
    const bounds = floorBounds(floor);
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const diagonal = Math.hypot(bounds.width, bounds.height);
      const w = Math.round((70 * bounds.width) / diagonal);
      const h = Math.round((89 * bounds.height) / diagonal);
      style["--pool-w"] = `max(${w}vw, 540px)`;
      style["--pool-h"] = `max(${h}vh, 400px)`;
    }
    return style;
  }, [floor]);

  return (
    <div
      className="grid h-screen w-screen overflow-hidden bg-[var(--frame)]"
      style={
        objectsOpen
          ? {
              gridTemplateColumns: "64px 306px 1fr",
              gridTemplateRows: "56px 1fr 38px",
              gridTemplateAreas:
                "'rail header header' 'rail library canvas' 'rail library status'",
            }
          : {
              gridTemplateColumns: "64px 1fr 320px",
              gridTemplateRows: "56px 1fr 38px",
              gridTemplateAreas:
                "'rail header inspector' 'rail canvas inspector' 'rail status inspector'",
            }
      }
    >
      <NavRail
        activeMode={viewMode}
        onSelectMode={setViewMode}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
      />
      {settingsOpen && (
        <SettingsPopover
          rooms={floor.rooms}
          unit={unit}
          onRename={renameRoom}
          onWallHeightChange={setCeilingHeight}
          onClose={closeSettings}
        />
      )}
      <WorkspaceHeader
        mode={viewMode}
        roomName={room.name ?? "Untitled room"}
        savedAt={savedAt}
        onNewRoom={startNewRoom}
        onSelectMode={setViewMode}
        onUndo={undoRoom}
        onRedo={redoRoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onFullscreen={toggleFullscreen}
        draftClosed={draft.closed}
        placingName={placing?.item.name ?? null}
        openingTool={openingTool}
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
              onRoomChange={commitRoom}
              onRoomPreview={previewRoom}
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
              draftCorners={draft.corners}
              draftClosed={draft.closed}
              draftRoomId={draft.roomId}
              onActivateDraftRoom={activateDraftRoom}
              onPlaceCorner={placeCorner}
              onPlaceRect={placeRect}
              onSetDraftSegmentLength={setDraftSegmentLength}
              onRequestCloseDraft={closeDraft}
              onMoveDraftCorner={moveDraftCorner}
              onSplitDraftWall={splitDraftWall}
              onDeleteDraftCorner={deleteDraftCorner}
              onStartDraw={startDrawAt}
              placingItem={placing?.item ?? null}
              onPlacingEnd={endPlacing}
              openingTool={openingTool}
              onOpeningToolDone={disarmOpeningTool}
            />
          </Suspense>
        )}
        {viewMode === "draw" && (
          <>
            <DrawToolStack
              tool={drawTool}
              onToolChange={handleDrawToolChange}
            />
            <DrawHintBar
              editing={draft.closed}
              rect={drawTool === "rect"}
              multiRoom={floor.rooms.length > 1}
            />
          </>
        )}
        {viewMode === "2d" && (
          <OpeningToolStack tool={openingTool} onToolChange={setOpeningTool} />
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
        floor={floor}
        selectedRoomName={selectedRoom?.name ?? null}
        portalStatus={portalStatus}
        cameraReadout={readoutStore}
        unit={unit}
        onUnitChange={setUnit}
        gridVisible={gridVisible}
        onToggleGrid={() => setGridVisible((on) => !on)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((on) => !on)}
        draftCornerCount={draft.corners.length}
        draftClosed={draft.closed}
        placingName={placing?.item.name ?? null}
        openingTool={openingTool}
      />
      {objectsOpen ? (
        <ObjectsPanel
          placingId={placing?.item.id ?? null}
          onStartPlacing={startPlacing}
          onClose={() => setViewMode("3d")}
        />
      ) : (
        <Inspector
          floor={floor}
          unit={unit}
          mode={viewMode}
          selectedRoom={selectedRoom}
          selectedItem={selectedItem}
          portalStatus={portalStatus}
          draftCornerCount={draft.corners.length}
          draftClosed={draft.closed}
          onResize={resizeSelected}
          onRotateTo={rotateSelectedTo}
          onElevate={elevateSelected}
          onMoveTo={moveSelectedTo}
          onRecolor={recolorSelected}
          onRotate90={rotateSelected90}
          onClone={cloneSelected}
          onDelete={deleteSelected}
        />
      )}
    </div>
  );
}
