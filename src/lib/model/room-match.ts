import type { Face } from "./faces";
import { faceLabelPoint } from "./faces";
import { pointInOutline } from "./geometry";
import type { RoomRecord } from "./types";

/**
 * Room identity on top of the wall graph's faces (Task G2): faces are
 * anonymous regions recomputed from scratch on every edit, but a room's
 * name, wall height, and other settings need to survive across edits that
 * don't change its shape. `RoomRecord` (in `types.ts`) is the persistent
 * identity; each `matchRooms` call reconciles the registry against the
 * current faces by anchor containment, so a record that momentarily has no
 * matching face (mid-edit, wall not yet closed) goes dormant instead of
 * disappearing, and revives if its shape closes again later.
 */

/** A record matched to the face it currently occupies. */
export interface MatchedRoom {
  record: RoomRecord;
  face: Face;
}

export interface RoomMatchResult {
  /** Records matched to a face this call, in registry order. */
  matched: MatchedRoom[];
  /** The full updated registry: matched records with re-centered anchors,
   * dormant records unchanged, new records appended in face order. */
  records: RoomRecord[];
}

/**
 * A "Room N" name not already taken, N starting at (entry count + 1) — the
 * old `nextRoomName` convention (pre-graph `model/floor.ts`), generalized to
 * any iterable of already-used names (unnamed entries count, like unnamed
 * rooms do there) rather than a `Floor`.
 */
export function nextRoomNameFrom(taken: Iterable<string | undefined>): string {
  const seen: (string | undefined)[] = [...taken];
  const used = new Set(seen);
  for (let n = seen.length + 1; ; n++) {
    const name = `Room ${n}`;
    if (!used.has(name)) return name;
  }
}

/**
 * Reconcile a room-record registry against the wall graph's current faces.
 *
 * Pass 1: each record, in registry order, claims the first not-yet-claimed
 * face whose polygon contains its anchor — so when two anchors land in the
 * same face (a wall removed, merging two rooms), the earlier record in the
 * registry wins the face and the later one goes dormant. A matched record's
 * anchor is re-centered to `faceLabelPoint(face.polygon)`, producing a new
 * record object only when the anchor actually moved (the Floor no-op
 * contract propagates through unrelated re-matches). Unmatched records stay
 * in the registry, unchanged (dormant) — a room whose walls are mid-edit or
 * not yet closed keeps its name/settings rather than being deleted.
 *
 * Pass 2: every face nobody claimed gets a brand-new record, named via
 * `nextRoomNameFrom` over every name in the registry so far (including
 * earlier new records from this same call), appended in face order.
 */
export function matchRooms(
  records: RoomRecord[],
  faces: Face[],
  newRecordId: () => string = () => crypto.randomUUID(),
): RoomMatchResult {
  const claimedFaces = new Set<Face>();
  const matchedByRecordId = new Map<string, Face>();

  for (const record of records) {
    const face = faces.find(
      (f) => !claimedFaces.has(f) && pointInOutline(f.polygon, record.anchor),
    );
    if (!face) continue;
    claimedFaces.add(face);
    matchedByRecordId.set(record.id, face);
  }

  const records1 = records.map((record) => {
    const face = matchedByRecordId.get(record.id);
    if (!face) return record;
    const anchor = faceLabelPoint(face.polygon);
    if (anchor.x === record.anchor.x && anchor.y === record.anchor.y) {
      return record;
    }
    return { ...record, anchor };
  });

  const newRecords: RoomRecord[] = [];
  for (const face of faces) {
    if (claimedFaces.has(face)) continue;
    const takenNames = [...records1, ...newRecords].map((r) => r.name);
    const record: RoomRecord = {
      id: newRecordId(),
      name: nextRoomNameFrom(takenNames),
      anchor: faceLabelPoint(face.polygon),
    };
    newRecords.push(record);
    matchedByRecordId.set(record.id, face);
  }

  const allRecords = [...records1, ...newRecords];
  const matched: MatchedRoom[] = [];
  for (const record of allRecords) {
    const face = matchedByRecordId.get(record.id);
    if (face) matched.push({ record, face });
  }

  return { matched, records: allRecords };
}
