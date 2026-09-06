// Angle-map shaping: coerce whatever the cartographer returns into a valid
// AngleMap, work out which angles the scouts actually visit, and apply the
// ladder's pruning rules (unchecking a parent unchecks its subtree).

import type { Angle, AngleLevel, AngleMap } from '../../../shared/skills';
import { slugify } from '../../store';

const LEVELS = new Set<AngleLevel>(['foundation', 'working', 'advanced']);
const MAX_ANGLES = 60;

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

/**
 * Defensive coercion of a model-authored map. Ids become unique slugs, levels
 * and estSources are clamped, and an angle whose parentId does not resolve to a
 * top-level angle is dropped.
 */
export function coerceAngleMap(raw: unknown): AngleMap {
  const list = Array.isArray((raw as AngleMap)?.angles)
    ? (raw as AngleMap).angles
    : Array.isArray(raw)
      ? (raw as Angle[])
      : [];

  // Pass 1: ids and fields. Remember the id each entry was renamed from so
  // parentIds written against the original ids still resolve.
  const seen = new Set<string>();
  const rename = new Map<string, string>();
  const draft: Angle[] = [];
  for (const item of list) {
    const a = (item ?? {}) as Partial<Angle>;
    const title = str(a.title, 80);
    if (!title) continue;
    const base = slugify(String(a.id ?? title), 'angle');
    let id = base;
    let n = 2;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id);
    // First writer wins, so a later duplicate cannot steal an id someone points at.
    if (typeof a.id === 'string' && !rename.has(a.id)) rename.set(a.id, id);
    if (!rename.has(id)) rename.set(id, id);
    const angle: Angle = {
      id,
      title,
      level: LEVELS.has(a.level as AngleLevel) ? (a.level as AngleLevel) : 'working',
      kept: true,
      estSources: clampInt(a.estSources, 1, 40, 6),
    };
    const why = str(a.why, 200);
    if (why) angle.why = why;
    const parent = typeof a.parentId === 'string' ? a.parentId : '';
    if (parent) angle.parentId = parent;
    draft.push(angle);
    if (draft.length >= MAX_ANGLES) break;
  }

  // Pass 2: resolve parents. A parent that is itself a child collapses to the
  // grandparent (the ladder is two levels); an unresolvable parent drops the angle.
  const byId = new Map(draft.map((a) => [a.id, a]));
  const kept: Angle[] = [];
  for (const a of draft) {
    if (!a.parentId) { kept.push(a); continue; }
    const resolved = rename.get(a.parentId) ?? (byId.has(a.parentId) ? a.parentId : undefined);
    const parent = resolved ? byId.get(resolved) : undefined;
    if (!parent || parent.id === a.id) continue;                 // bad parentId -> drop the angle
    const grand = parent.parentId ? byId.get(rename.get(parent.parentId) ?? parent.parentId) : undefined;
    a.parentId = grand && grand.id !== a.id ? grand.id : parent.id;
    if (a.parentId === a.id) continue;
    kept.push(a);
  }

  return { angles: orderLadder(kept) };
}

/** Top-level angles in their given order, each immediately followed by its children. */
export function orderLadder(angles: Angle[]): Angle[] {
  const tops = angles.filter((a) => !a.parentId);
  const topIds = new Set(tops.map((a) => a.id));
  const out: Angle[] = [];
  for (const top of tops) {
    out.push(top);
    for (const child of angles) if (child.parentId === top.id) out.push(child);
  }
  // Orphans (parent lost during a later edit) ride along at the end as top-level.
  for (const a of angles) {
    if (!out.includes(a) && !topIds.has(a.id)) out.push({ ...a, parentId: undefined });
  }
  return out;
}

/**
 * The angles a scout actually visits: kept leaves. A kept parent with kept
 * children is covered by those children; a kept parent with none is scouted itself.
 */
export function scoutTargets(map: AngleMap | undefined): Angle[] {
  const kept = (map?.angles ?? []).filter((a) => a.kept);
  const keptIds = new Set(kept.map((a) => a.id));
  const parents = new Set<string>();
  for (const a of kept) if (a.parentId && keptIds.has(a.parentId)) parents.add(a.parentId);
  return kept.filter((a) => !parents.has(a.id));
}

/**
 * Apply an edited ladder: only `kept` flags and order may move. Unknown ids are
 * ignored, missing ones keep their old state, and unchecking a parent
 * unchecks everything under it.
 */
export function applyMapEdit(current: AngleMap, edited: AngleMap | undefined): AngleMap {
  const byId = new Map(current.angles.map((a) => [a.id, a]));
  const wanted = Array.isArray(edited?.angles) ? edited!.angles : [];
  const out: Angle[] = [];
  const placed = new Set<string>();
  for (const e of wanted) {
    const id = typeof e?.id === 'string' ? e.id : '';
    const base = byId.get(id);
    if (!base || placed.has(id)) continue;
    placed.add(id);
    out.push({ ...base, kept: e.kept !== false });
  }
  for (const a of current.angles) if (!placed.has(a.id)) out.push(a);

  const ordered = orderLadder(out);
  const keptById = new Map(ordered.map((a) => [a.id, a.kept]));
  return {
    angles: ordered.map((a) => (a.parentId && keptById.get(a.parentId) === false ? { ...a, kept: false } : a)),
  };
}

/** Cheap, deliberately shy angle guess for a user-pasted source. */
export function guessAngleIds(map: AngleMap | undefined, haystack: string): string[] {
  const hay = ` ${haystack.toLowerCase().replace(/\s+/g, ' ')} `;
  const hits: string[] = [];
  for (const a of map?.angles ?? []) {
    if (!a.kept) continue;
    const title = a.title.toLowerCase();
    if (title.length >= 4 && hay.includes(` ${title} `)) hits.push(a.id);
    else if (a.id.length >= 5 && hay.includes(a.id.replace(/-/g, ' '))) hits.push(a.id);
  }
  return hits.slice(0, 4);
}
