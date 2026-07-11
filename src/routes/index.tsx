import { createFileRoute } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
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
import { StatusBar } from "#/components/status-bar";
import { WorkspaceHeader } from "#/components/workspace-header";
import { ZoomPill } from "#/components/zoom-pill";
import { type CameraApi, createCameraReadoutStore } from "#/lib/camera";
import { containRoomFurniture } from "#/lib/collision";
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
  type CatalogItem,
  createSampleRoom,
  duplicateFurniture,
  type Footprint,
  type OpeningKind,
  type Point,
  type Room,
  removeFurniture,
  rotateFurniture,
  setFurnitureColorway,
  setFurnitureFootprint,
  setFurnitureRotation,
  setMountElevation,
  updateFurniture,
} from "#/lib/model";
import {
  applyOutlineDraft,
  draftFromRoom,
  emptyOutlineDraft,
  sameOutline,
  setClosedSegmentLength,
  splitOutlineWall,
} from "#/lib/outline-edit";
import {
  deserializeSavedState,
  STORAGE_KEY,
  serializeSavedState,
} from "#/lib/persistence";
import type { Unit } from "#/lib/units";
import type { ViewMode } from "#/lib/view-mode";

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
  // The room lives inside a bounded undo/redo history. Discrete mutations
  // (add/rotate/duplicate/delete, opening edits, outline close) go through
  // `setRoom` = one undo step each; the continuous drags stream through
  // `previewRoom` and fold into a single step when `settleRoom` fires at
  // gesture end — an esc-cancelled drag leaves no step at all.
  const [roomHistory, setRoomHistory] = useState(() =>
    createHistory(createSampleRoom()),
  );
  const room = roomHistory.current;
  const setRoom = useCallback((next: Room | ((room: Room) => Room)) => {
    setRoomHistory((history) => {
      const value = typeof next === "function" ? next(history.current) : next;
      // The pure model setters return the same reference for no-ops —
      // those must not become empty undo steps (or clear the redo stack).
      return value === history.current
        ? history
        : commitHistory(history, value);
    });
  }, []);
  const previewRoom = useCallback(
    (next: Room) => setRoomHistory((history) => previewHistory(history, next)),
    [],
  );
  const settleRoom = useCallback(() => setRoomHistory(settleHistory), []);
  const undoRoom = useCallback(() => setRoomHistory(undoHistory), []);
  const redoRoom = useCallback(() => setRoomHistory(redoHistory), []);
  // Draw mode edits the draft, not the room — room history sits it out
  // (undoing the room underneath a seeded draft would silently desync them).
  const historyActive = viewMode !== "draw";
  const canUndo = historyActive && roomHistory.past.length > 0;
  const canRedo = historyActive && roomHistory.future.length > 0;
  const [unit, setUnit] = useState<Unit>("m");
  // The furniture selection is route state so the inspector (outside the
  // canvas) and the in-scene picking/label share one selection. The canvas
  // keeps opening selection internal and clears this one when it takes over.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem =
    room.furniture.find((item) => item.id === selectedId) ?? null;
  // Inspector commits: one history step each. The pure setters return the
  // room unchanged (same reference) for no-ops, which must not become empty
  // undo steps. Rotations/resizes re-contain the item so it can't poke out.
  const rotateSelected90 = useCallback(() => {
    if (!selectedId) return;
    setRoom((current) =>
      containRoomFurniture(
        rotateFurniture(current, selectedId, 90),
        selectedId,
      ),
    );
  }, [selectedId, setRoom]);
  const cloneSelected = useCallback(() => {
    if (!selectedId) return;
    const newId = crypto.randomUUID();
    setRoom((current) =>
      containRoomFurniture(
        duplicateFurniture(current, selectedId, newId),
        newId,
      ),
    );
    // Selection follows the copy, like a drop.
    setSelectedId(newId);
  }, [selectedId, setRoom]);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setRoom((current) => removeFurniture(current, selectedId));
    setSelectedId(null);
  }, [selectedId, setRoom]);
  const resizeSelected = useCallback(
    (footprint: Footprint) => {
      if (!selectedId) return;
      setRoom((current) => {
        const next = setFurnitureFootprint(current, selectedId, footprint);
        return next === current
          ? current
          : containRoomFurniture(next, selectedId);
      });
    },
    [selectedId, setRoom],
  );
  const rotateSelectedTo = useCallback(
    (deg: number) => {
      if (!selectedId) return;
      setRoom((current) => {
        const next = setFurnitureRotation(current, selectedId, deg);
        return next === current
          ? current
          : containRoomFurniture(next, selectedId);
      });
    },
    [selectedId, setRoom],
  );
  const elevateSelected = useCallback(
    (elevation: number) => {
      if (!selectedId) return;
      setRoom((current) => setMountElevation(current, selectedId, elevation));
    },
    [selectedId, setRoom],
  );
  const moveSelectedTo = useCallback(
    (position: Point) => {
      if (!selectedId) return;
      setRoom((current) =>
        containRoomFurniture(
          updateFurniture(current, selectedId, { position }),
          selectedId,
        ),
      );
    },
    [selectedId, setRoom],
  );
  const recolorSelected = useCallback(
    (colorway: string | null) => {
      if (!selectedId) return;
      setRoom((current) => setFurnitureColorway(current, selectedId, colorway));
    },
    [selectedId, setRoom],
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

  // Autosave: hydrate once after mount (SSR renders the sample room —
  // localStorage only exists on the client), then write back on every room
  // or unit change. `lastSavedRef` holds the last payload written or loaded,
  // so hydration itself doesn't count as a save and reloads keep the honest
  // saved-at time instead of resetting the clock to "just now".
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    const saved = deserializeSavedState(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      // Hydration replaces the pre-mount sample room outright — resetting
      // history keeps it out of the undo stack.
      setRoomHistory(createHistory(saved.room));
      setUnit(saved.unit);
      setSavedAt(saved.savedAt);
      lastSavedRef.current = JSON.stringify({
        room: saved.room,
        unit: saved.unit,
      });
    }
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    const payload = JSON.stringify({ room, unit });
    if (payload === lastSavedRef.current) return;
    lastSavedRef.current = payload;
    const now = Date.now();
    localStorage.setItem(
      STORAGE_KEY,
      serializeSavedState({ room, unit, savedAt: now }),
    );
    setSavedAt(now);
  }, [storageReady, room, unit]);

  // The draw-mode draft outline. Owned here (not by the canvas) so the
  // header's status line can count corners and committing can become the
  // room. Entering draw mode over an existing room reopens its outline as a
  // *closed* editable draft ("Draw" means "edit this room"); only an empty
  // outline — right after New room — starts the open from-scratch draft.
  // Leaving draw mode applies a closed draft, so lens switches never lose
  // edits; esc reverts it instead.
  const [draft, setDraft] = useState(emptyOutlineDraft);
  const [drawTool, setDrawTool] = useState<DrawTool>("wall");
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (prev === viewMode) return;
    prevViewModeRef.current = viewMode;
    if (viewMode === "draw") {
      // Seed from the room; an in-progress open draft (mid fresh drawing)
      // survives the round trip through another lens.
      if (room.outline.length >= 3) setDraft(draftFromRoom(room));
    } else if (prev === "draw" && draft.closed) {
      if (
        draft.corners.length >= 3 &&
        !sameOutline(draft.corners, room.outline)
      ) {
        setRoom((current) =>
          applyOutlineDraft(current, draft.corners, draft.openings),
        );
      }
      setDraft(emptyOutlineDraft());
    }
  }, [viewMode, room, draft, setRoom]);

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
  // The rect tool's two clicks: replace the draft with a fresh closed
  // rectangle and hand off to Select so its corners drag / lengths edit like
  // any closed draft. Openings drop (they belonged to a different outline);
  // furniture that still fits is kept at commit by `applyOutlineDraft`.
  const placeRect = useCallback((a: Point, b: Point) => {
    const corners = rectangleOutline(a, b);
    if (!corners) return;
    setDraft({ corners, closed: true, openings: [] });
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
  // ⏎ (or clicking the start corner while drawing) commits the draft: the
  // outline becomes the room, openings re-anchor to their (possibly resized
  // or split) walls, and furniture stays wherever it still fits inside.
  const closeDraft = useCallback(() => {
    if (draft.corners.length < 3) return;
    if (!sameOutline(draft.corners, room.outline)) {
      setRoom((current) =>
        applyOutlineDraft(current, draft.corners, draft.openings),
      );
    }
    setDraft(emptyOutlineDraft());
    setViewMode("2d");
  }, [draft, room.outline, setRoom]);
  // Esc reverts an edit session to the room as it stands; a fresh open
  // draft just clears.
  const cancelDraft = useCallback(
    () =>
      setDraft((current) =>
        current.closed ? draftFromRoom(room) : emptyOutlineDraft(),
      ),
    [room],
  );

  // The "new room" escape hatch: clear the room (autosave persists the
  // cleared state, wiping the old save) and start over in draw mode.
  const startNewRoom = useCallback(() => {
    if (
      !window.confirm(
        "Start a new room? The current room and its autosave will be cleared.",
      )
    ) {
      return;
    }
    setRoom({
      name: "Untitled room",
      outline: [],
      openings: [],
      furniture: [],
    });
    setDraft(emptyOutlineDraft());
    setViewMode("draw");
  }, [setRoom]);

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

  // Screen 2d: in objects mode the library docks as its own column between
  // rail and canvas, and the inspector yields the right edge to give the
  // canvas room (the header spans across instead).
  const objectsOpen = viewMode === "objects";

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
      <NavRail activeMode={viewMode} onSelectMode={setViewMode} />
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
        style={{ gridArea: "canvas" }}
        data-view-mode={viewMode}
      >
        {canvasReady && (
          <Suspense fallback={null}>
            <PlannerCanvas
              room={room}
              onRoomChange={setRoom}
              onRoomPreview={previewRoom}
              onRoomGestureEnd={settleRoom}
              viewMode={viewMode}
              selectedId={selectedId}
              onSelectedIdChange={setSelectedId}
              cameraApiRef={cameraApiRef}
              readoutStore={readoutStore}
              unit={unit}
              gridVisible={gridVisible}
              snapEnabled={snapEnabled}
              drawTool={drawTool}
              draftCorners={draft.corners}
              draftClosed={draft.closed}
              onPlaceCorner={placeCorner}
              onPlaceRect={placeRect}
              onSetDraftSegmentLength={setDraftSegmentLength}
              onRequestCloseDraft={closeDraft}
              onMoveDraftCorner={moveDraftCorner}
              onSplitDraftWall={splitDraftWall}
              placingItem={placing?.item ?? null}
              onPlacingEnd={endPlacing}
              openingTool={openingTool}
              onOpeningToolDone={disarmOpeningTool}
            />
          </Suspense>
        )}
        {viewMode === "draw" && (
          <>
            <DrawToolStack tool={drawTool} onToolChange={setDrawTool} />
            <DrawHintBar editing={draft.closed} rect={drawTool === "rect"} />
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
        room={room}
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
          room={room}
          unit={unit}
          mode={viewMode}
          selectedItem={selectedItem}
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
