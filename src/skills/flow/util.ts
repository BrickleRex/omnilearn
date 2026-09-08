// Small shared helpers for the skills flow screens.
import type { Angle, SkillModule, SkillProject, SkillTarget, Specificity } from '../../../shared/skills';
import type { SkillScreen } from '../../nav';

/** The nine beats of a skill project, in order. */
export const BEATS = ['Frame', 'Map', 'Research', 'Calibrate', 'Learn', 'Drill', 'Make', 'Ship', 'Refresh'] as const;

const SCREEN_BEAT: Record<SkillScreen, number> = {
  map: 1, research: 2, calibrate: 3, learn: 4, drills: 5, make: 6,
};

export function beatIndex(screen: SkillScreen, project?: SkillProject | null): number {
  if (project && project.phase === 'framing') return 0;
  return SCREEN_BEAT[screen] ?? 0;
}

/** drills + runs + ships — the number that shows up on every screen. */
export function repCount(p: SkillProject | null | undefined): number {
  const r = p?.reps;
  return (r?.drills ?? 0) + (r?.runs ?? 0) + (r?.ships ?? 0);
}

/** The module a screen should work on: the asked-for one, else the current one. */
export function pickModule(p: SkillProject | null | undefined, moduleId?: string): SkillModule | undefined {
  const mods = p?.course?.modules ?? [];
  return mods.find((m) => m.id === moduleId) ?? mods.find((m) => m.status === 'current') ?? mods[0];
}

/** Where a skill in this phase wants to be opened. */
export function screenForPhase(p: { phase: SkillProject['phase'] }): SkillScreen {
  switch (p.phase) {
    case 'framing': case 'mapping': return 'map';
    case 'researching': return 'research';
    case 'calibrating': return 'calibrate';
    case 'learning': return 'learn';
    case 'practicing': return 'drills';
    case 'making': return 'make';
    default: return 'map';
  }
}

export interface AngleNode { angle: Angle; children: AngleNode[] }

/** parentId -> nested tree, roots keep the cartographer's order. */
export function angleTree(angles: Angle[]): AngleNode[] {
  const nodes = new Map<string, AngleNode>();
  for (const a of angles) nodes.set(a.id, { angle: a, children: [] });
  const roots: AngleNode[] = [];
  for (const a of angles) {
    const n = nodes.get(a.id)!;
    const parent = a.parentId ? nodes.get(a.parentId) : undefined;
    if (parent) parent.children.push(n); else roots.push(n);
  }
  return roots;
}

/** Every id under (and including) `id`. */
export function subtreeIds(angles: Angle[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of angles) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) { out.add(a.id); grew = true; }
    }
  }
  return out;
}

/**
 * "~230 sources · ~55 min". Only kept LEAF angles get a scout (a kept parent with
 * kept children is covered by them), a scout brings back at most ~10 sources,
 * three scouts run at once at ~4 min each, and assessing/reconciling/building
 * the course adds ~20 min. Calibrated on the live cold-email run (26 scouts →
 * 214 sources in 87 min).
 */
export function estimate(angles: Angle[]): { sources: number; minutes: number; text: string } {
  const kept = angles.filter((a) => a.kept);
  const hasKeptChild = new Set(kept.filter((a) => a.parentId).map((a) => a.parentId as string));
  const scouts = kept.filter((a) => !hasKeptChild.has(a.id));
  const sources = scouts.reduce((n, a) => n + Math.min(10, Math.max(3, a.estSources || 0)), 0);
  const minutes = scouts.length ? Math.ceil(scouts.length / 3) * 4 + 20 : 0;
  return { sources, minutes, text: `~${sources} sources · ~${minutes} min` };
}

/** Reading is rationed: no unit renders more than ~120 words. */
export function clampWords(text: string, max = 120): { head: string; clamped: boolean } {
  const words = (text ?? '').split(/\s+/).filter(Boolean);
  if (words.length <= max) return { head: text ?? '', clamped: false };
  return { head: `${words.slice(0, max).join(' ')} …`, clamped: true };
}

export function shorten(text: string, max = 46): string {
  const t = (text ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** "VPs of Sales · B2B SaaS · United States" — the long-tail target, blanks dropped. */
export function targetLine(t?: SkillTarget | null): string {
  return [t?.who, t?.industry, t?.where].map((s) => (s ?? '').trim()).filter(Boolean).join(' · ');
}

/** Sort key: niche first, then adjacent, then general, then anything unlabelled. */
export function specRank(s?: Specificity): number {
  return s === 'niche' ? 0 : s === 'adjacent' ? 1 : s === 'general' ? 2 : 3;
}
