// Points of interest (POIs) — the places a fleet keeps coming back to:
// the office, a customer's yard, the usual fuel stop.
//
// Traccar has no POI endpoint, so the list lives inside the logged-in user's
// `attributes.carvaPois`. That ties pins to the account instead of a browser.
// Traccar replaces the whole record on PUT /api/users/{id}, so we always read
// the user back, patch that one attribute and send everything else untouched —
// sending a partial object wipes the fields you left out.
//
// When the account can't write itself back (read-only users, permission
// errors, server down) we fall back to a localStorage copy and tell the caller
// the list is device-only. The next load merges that copy back on top of the
// account list — a place that only reached the device must never be dropped
// just because the account also has places of its own. The device copy holds
// the newer edits (it only exists because a save failed), so it wins for ids
// both copies know about, and it carries tombstones so a delete made while the
// account was unreachable is not resurrected on the next load.
//
// Saves are merged, never blind: we re-read the account list and apply the
// caller's intent (adds/updates by id, deletes by id) on top of it, so a second
// tab or a colleague sharing the account can't have their places PUT away.
//
// Deliberately React-free so the live fleet map can reuse it later.

export const POI_CATEGORIES = [
  'office',
  'customer',
  'fuel',
  'service',
  'parking',
  'other',
] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  notes?: string;
  /** ISO timestamp of when the pin was dropped. */
  createdAt: string;
}

/** Marker colour per category. Hex, because raw-DOM map markers use it too. */
export const POI_COLORS: Record<PoiCategory, string> = {
  office: '#4f46e5',
  customer: '#0ea5e9',
  fuel: '#f59e0b',
  service: '#ef4444',
  parking: '#10b981',
  other: '#64748b',
};

/** i18n key for a category's label. */
export function poiCategoryKey(category: string): string {
  return `poi.cat.${isPoiCategory(category) ? category : 'other'}`;
}

export function isPoiCategory(value: unknown): value is PoiCategory {
  return (
    typeof value === 'string' && (POI_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Colour for any category string; unknown categories fall back to "other". */
export function poiColor(category: string): string {
  return isPoiCategory(category) ? POI_COLORS[category] : POI_COLORS.other;
}

/* ------------------------------ Validation ------------------------------- */

const LOCAL_KEY = 'carva.pois';
const CARVA_ATTRIBUTE = 'carvaPois';

/** The slice of a Traccar user record we read; the rest rides along on PUT. */
interface TraccarUserRecord {
  id: number;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `poi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Coerce whatever is stored (user attributes are free-form JSON) into a clean
 * POI array. Anything without usable coordinates is dropped rather than
 * rendered as a marker at 0,0 off the coast of Africa.
 */
export function parsePois(value: unknown): Poi[] {
  if (!Array.isArray(value)) return [];
  const out: Poi[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'POI',
      lat,
      lng,
      category: isPoiCategory(raw.category) ? raw.category : 'other',
      notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined,
      createdAt:
        typeof raw.createdAt === 'string' && raw.createdAt
          ? raw.createdAt
          : new Date().toISOString(),
    });
  }
  return out;
}

export function createPoi(input: {
  name: string;
  lat: number;
  lng: number;
  category: string;
  notes?: string;
}): Poi {
  return {
    id: newId(),
    name: input.name.trim(),
    lat: input.lat,
    lng: input.lng,
    category: isPoiCategory(input.category) ? input.category : 'other',
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

/** Filter by name, notes or category slug. Empty query returns everything. */
export function searchPois(pois: Poi[], query: string): Poi[] {
  const q = query.trim().toLowerCase();
  if (!q) return pois;
  return pois.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.notes?.toLowerCase().includes(q) ?? false),
  );
}

/** Fixed-precision coordinate pair for list rows and form previews. */
export function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/* ------------------------------ Persistence ------------------------------ */

export type PoiStorage = 'remote' | 'local';

export interface PoiLoadResult {
  pois: Poi[];
  /**
   * `"local"` whenever this device still holds an unsaved copy of the list, so
   * the caller keeps warning until a save gets it into the account. Also
   * `"local"` when the account copy could not be read at all — `error` is set
   * in that case, and it is the only case where the list may be incomplete.
   */
  storage: PoiStorage;
  /** Why the account copy was unreachable, when it was. */
  error?: string;
}

export interface PoiSaveResult {
  /** False only when both the account and this device refused the write. */
  ok: boolean;
  storage: PoiStorage;
  error?: string;
  /**
   * What actually ended up stored. The account list is merged, not replaced, so
   * this can hold places the caller had never seen — adopt it as the new list.
   */
  pois: Poi[];
  /** The account had moved on: `pois` is the merge, not what the caller sent. */
  conflict?: boolean;
}

async function fetchSessionUser(): Promise<TraccarUserRecord> {
  const res = await fetch('/api/traccar/session', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const user = (await res.json()) as unknown;
  if (!isRecord(user) || typeof user.id !== 'number') {
    throw new Error('unexpected session response');
  }
  return user as TraccarUserRecord;
}

/**
 * The device copy, stamped with the account it belongs to. Without the stamp a
 * leftover copy would be merged into — and then saved onto — whichever account
 * signs in next on this browser.
 */
interface LocalCopy {
  /** False when this browser holds no fallback copy at all. */
  present: boolean;
  /** Undefined for copies written before the stamp, or when the session was unreadable. */
  userId?: number;
  pois: Poi[];
  /**
   * Ids deleted while the account write was failing. A deletion leaves no trace
   * in `pois`, so without these the account copy would resurrect it on load.
   */
  deleted: string[];
}

const NO_LOCAL_COPY: LocalCopy = { present: false, pois: [], deleted: [] };

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function readLocal(): LocalCopy {
  if (typeof window === 'undefined') return NO_LOCAL_COPY;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return NO_LOCAL_COPY;
    const parsed = JSON.parse(raw) as unknown;
    // Older copies are a bare array; they belong to whoever is signed in.
    if (Array.isArray(parsed)) {
      return { present: true, pois: parsePois(parsed), deleted: [] };
    }
    if (!isRecord(parsed)) return NO_LOCAL_COPY;
    return {
      present: true,
      userId: typeof parsed.userId === 'number' ? parsed.userId : undefined,
      pois: parsePois(parsed.pois),
      deleted: parseIds(parsed.deleted),
    };
  } catch {
    return NO_LOCAL_COPY;
  }
}

/**
 * Is this device's copy safe to merge into — and re-save onto — the given
 * account? Unstamped copies predate the stamp and belong to whoever is signed
 * in; a copy stamped with another account is never touched.
 */
function localIsMine(local: LocalCopy, userId: number | undefined): boolean {
  if (!local.present) return false;
  // userId is unknown only when the session itself was unreadable — then we are
  // overwriting the key with an unstamped copy anyway.
  return local.userId === undefined || userId === undefined || local.userId === userId;
}

function writeLocal(pois: Poi[], userId: number | undefined, deleted: string[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // A place that came back is no longer a deletion.
    const live = new Set(pois.map((p) => p.id));
    const tombstones = [...new Set(deleted)].filter((id) => !live.has(id));
    window.localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({ userId, pois, deleted: tombstones }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Do two lists hold the same places with the same fields? Order-insensitive. */
function samePoiLists(a: Poi[], b: Poi[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((p) => [p.id, p]));
  for (const p of a) {
    const other = byId.get(p.id);
    if (!other) return false;
    if (
      other.name !== p.name ||
      other.lat !== p.lat ||
      other.lng !== p.lng ||
      other.category !== p.category ||
      (other.notes ?? '') !== (p.notes ?? '')
    ) {
      return false;
    }
  }
  return true;
}

/** Drop this device's copy — ours only, never another account's fallback. */
function clearLocal(userId: number): void {
  if (typeof window === 'undefined') return;
  try {
    const owner = readLocal().userId;
    if (owner !== undefined && owner !== userId) return;
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    // Nothing to do — the account copy is authoritative anyway.
  }
}

/**
 * Load the signed-in user's POIs — the union of both copies, keyed by id. The
 * device copy wins for places both know about and its tombstones are applied,
 * because it only exists at all because a save failed: it is the copy holding
 * the user's newest renames, moves and deletions. While such a copy exists the
 * result stays marked `"local"` so the warning stays up until a save lands the
 * whole thing in the account.
 */
export async function loadPois(): Promise<PoiLoadResult> {
  const local = readLocal();
  try {
    const user = await fetchSessionUser();
    const remote = parsePois(user.attributes?.[CARVA_ATTRIBUTE]);

    // A copy stamped with another account is not ours to merge or re-save.
    const mine = localIsMine(local, user.id);
    const byId = new Map<string, Poi>(remote.map((p) => [p.id, p]));
    if (mine) {
      // A delete that only reached the device is still a delete.
      for (const id of local.deleted) byId.delete(id);
      for (const poi of local.pois) byId.set(poi.id, poi);
    }

    return {
      pois: [...byId.values()],
      storage: mine ? 'local' : 'remote',
    };
  } catch (e) {
    // Session unreadable: the device copy is all we have to show.
    return { pois: local.pois, storage: 'local', error: (e as Error).message };
  }
}

/**
 * Persist the list. Tries the account first (survives browser changes); on any
 * failure it writes this device's localStorage copy instead and reports
 * `storage: "local"` plus the reason, so the UI can warn the user.
 *
 * The account copy is merged, never replaced: we re-read it and apply this
 * caller's intent on top. `base` is the list the caller started from — anything
 * it held that `pois` no longer does counts as a delete, and everything else
 * the account holds is left alone. Without `base` the save can only add and
 * update, which is the safe reading of an unknown starting point.
 */
export async function savePois(pois: Poi[], base?: Poi[]): Promise<PoiSaveResult> {
  const local = readLocal();
  let remoteError = 'unknown error';
  // Stamps the fallback copy, so the next load knows whose places these are.
  let userId: number | undefined;

  // Ids this save means to remove: the ones the caller dropped from the list it
  // started out with, plus any delete that never made it off this device.
  const removed = new Set<string>();
  if (base) {
    const keep = new Set(pois.map((p) => p.id));
    for (const p of base) if (!keep.has(p.id)) removed.add(p.id);
  }

  try {
    const user = await fetchSessionUser();
    userId = user.id;
    if (localIsMine(local, userId)) {
      for (const id of local.deleted) removed.add(id);
    }
    for (const p of pois) removed.delete(p.id);

    // Merge onto whatever the account holds right now — another tab, or a
    // colleague on the same Traccar account, may have added places this caller
    // has never seen, and a verbatim PUT of its list would delete them.
    const server = parsePois(user.attributes?.[CARVA_ATTRIBUTE]);
    const byId = new Map<string, Poi>(server.map((p) => [p.id, p]));
    for (const id of removed) byId.delete(id);
    for (const poi of pois) byId.set(poi.id, poi);
    const merged = [...byId.values()];

    // Full record back: Traccar overwrites the row with exactly what we send.
    const next: TraccarUserRecord = {
      ...user,
      attributes: { ...(user.attributes ?? {}), [CARVA_ATTRIBUTE]: merged },
    };
    const res = await fetch(`/api/traccar/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Traccar echoes the saved user — confirm our attribute really landed.
    const saved = (await res.json()) as unknown;
    const stored =
      isRecord(saved) && isRecord(saved.attributes)
        ? saved.attributes[CARVA_ATTRIBUTE]
        : undefined;
    if (!Array.isArray(stored) || stored.length !== merged.length) {
      throw new Error('server did not store the places');
    }

    // The account confirmed the whole list — including anything that had been
    // living on the device — so the copy has nothing left to rescue.
    clearLocal(user.id);
    return {
      ok: true,
      storage: 'remote',
      pois: merged,
      // The account held changes the caller had not seen; it is now looking at
      // a list it never asked for, so let it say so instead of us hiding it.
      conflict: !samePoiLists(merged, pois),
    };
  } catch (e) {
    remoteError = (e as Error).message;
  }

  // Fallback copy: carry the tombstones forward, or the next successful save
  // would push the deleted places straight back into the account.
  if (localIsMine(local, userId)) {
    for (const id of local.deleted) removed.add(id);
  }
  for (const p of pois) removed.delete(p.id);

  return {
    ok: writeLocal(pois, userId, [...removed]),
    storage: 'local',
    error: remoteError,
    pois,
  };
}

