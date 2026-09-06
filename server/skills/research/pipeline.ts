// The research pipeline: a resumable background job per skill.
//
// job.json is the source of truth for progress; each phase writes its artifact
// and then advances, so a restart resumes from the first phase whose artifact
// is missing. Under LLM_MOCK=1 the whole thing runs off the fixture corpus.
//
//   cartography -> scouting -> enriching -> assessing -> reconciling -> architecting

import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  Angle, AngleMap, Claim, Course, Drill, Frame, Persona, ResearchJob, ResearchPhase,
  RubricItem, SkillModule, SkillProject, SourceKind, SourceRef, Verdict,
} from '../../../shared/skills';
import type { Concept, PrimerUnit } from '../../../shared/types';
import { callClaude, extractJson, isMock } from '../../llm/llm';
import { getSettings } from '../../settings';
import { exists, readJson, slugify, writeJson } from '../../store';
import {
  loadClaims, loadMap, loadSources, researchDir, saveClaims, saveCourse, saveMap, saveSkill, saveSources, sourceTextFile,
} from '../store';
import * as fixtures from '../fixtures';
import * as prompts from './prompts';
import { coerceAngleMap, scoutTargets } from './angles';
import { horizonMonths, isStale, monthsSince, recencyFactor } from './decay';
import { enrichSource, guessSourceKind, normalizeUrl } from './enrich';
import { JobCtl, currentJob, emptyJob, isRunning, publish, startJob } from './job';

const MOCK_TICK = 150;
const SCOUT_PARALLEL = 3;
const ENRICH_PARALLEL = 4;
const SCOUT_TIMEOUT_MS = 15 * 60_000;
const CREW_TIMEOUT_MS = 8 * 60_000;
const CARTO_TIMEOUT_MS = 240_000;
const ASSESS_BATCH = 8;
const TAG_BATCH = 20;
const RECONCILE_BATCH = 60;
const MIN_CONFIDENCE = 0.35;

const SOURCE_KINDS = new Set<SourceKind>(['reddit', 'youtube', 'blog', 'x', 'facebook', 'docs', 'podcast', 'user', 'other']);

/** Kind priors the assessor starts from (it may move them). */
export const KIND_PRIOR: Record<SourceKind, number> = {
  docs: 0.9, user: 0.9, blog: 0.6, reddit: 0.5, x: 0.5, youtube: 0.5, podcast: 0.5, facebook: 0.35, other: 0.4,
};

// ---------- extra artifact paths (store.ts owns the shared ones) ----------

const safeName = (s: string) => String(s).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'x';
export const scoutDir = (id: string) => path.join(researchDir(id), 'scout');
export const scoutFile = (id: string, angleId: string) => path.join(scoutDir(id), `${safeName(angleId)}.json`);
export const enrichedFile = (id: string) => path.join(researchDir(id), 'enriched.json');
export const draftClaimsFile = (id: string) => path.join(researchDir(id), 'claims.draft.json');
export const courseFileOf = (id: string) => path.join(researchDir(id), 'course.json');

// ---------- pure helpers (unit-tested) ----------

export interface ArtifactPresence {
  map: boolean; scouts: boolean; enriched: boolean; assessed: boolean; reconciled: boolean; architected: boolean;
}

/** The first phase whose artifact is missing — where a restart picks up. */
export function resumeFrom(a: ArtifactPresence): ResearchPhase {
  if (!a.map) return 'cartography';
  if (!a.scouts) return 'scouting';
  if (!a.enriched) return 'enriching';
  if (!a.assessed) return 'assessing';
  if (!a.reconciled) return 'reconciling';
  if (!a.architected) return 'architecting';
  return 'done';
}

const mean = (xs: number[], fallback = 0.45): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;

export interface ConfidenceInput {
  reputations: number[];
  soundnesses: number[];
  newest?: string;
  horizon: number;      // months, from the angle's decay family
  consensus: number;    // how many distinct sources support it
  contested?: boolean;
  now?: Date;
}

/** confidence = f(reputation, soundness, consensus) decayed by recency. */
export function claimConfidence(input: ConfidenceInput): number {
  const rep = mean(input.reputations);
  const sound = mean(input.soundnesses);
  const agreement = Math.min(1, Math.max(0, input.consensus) / 3);
  // Triangulation carries the most weight: assessors score vendor blogs harshly
  // on soundness, so a claim three independent sources agree on must still be
  // able to earn the 'solid' stamp (live calibration: cold-email corpus, 2026-09).
  const base = 0.35 * rep + 0.25 * sound + 0.4 * agreement;
  const decayed = base * recencyFactor(input.newest, input.horizon, input.now);
  const penalised = input.contested ? decayed * 0.85 : decayed;
  return Math.round(Math.min(1, Math.max(0, penalised)) * 100) / 100;
}

export const SOLID_CONFIDENCE = 0.7;

/**
 * Verdict from the numbers. 'solid' needs the score AND at least two sources —
 * one source is never solid however good it looks. Anything else that is
 * neither stale nor contested reads as 'likely' — the frozen Verdict union has
 * no weaker label, so genuinely thin claims are dropped instead (MIN_CONFIDENCE).
 */
export function verdictFor(confidence: number, flags: { contested?: boolean; stale?: boolean; sources?: number }): Verdict {
  if (flags.stale) return 'stale';
  if (flags.contested) return 'contested';
  return confidence >= SOLID_CONFIDENCE && (flags.sources ?? 2) >= 2 ? 'solid' : 'likely';
}

/** The consensus-grid row: which source kinds back this claim, and which fight it. */
export function consensusFrom(
  sourceIds: string[],
  sides: { for: string[]; against: string[] } | undefined,
  kindOf: (id: string) => SourceKind | undefined,
): Claim['consensus'] {
  const against = new Set(sides?.against ?? []);
  const tally = new Map<SourceKind, { yes: boolean; no: boolean }>();
  for (const id of new Set(sourceIds)) {
    const kind = kindOf(id);
    if (!kind) continue;
    const cell = tally.get(kind) ?? { yes: false, no: false };
    if (against.has(id)) cell.no = true;
    else cell.yes = true;
    tally.set(kind, cell);
  }
  const out: Claim['consensus'] = {};
  for (const [kind, cell] of tally) {
    out[kind] = cell.yes && cell.no ? 'mixed' : cell.no ? 'disagree' : 'agree';
  }
  return out;
}

/** Newest ISO date among a set of sources, if any of them is dated. */
export function newestDate(dates: Array<string | undefined>): string | undefined {
  const valid = dates.filter((d): d is string => typeof d === 'string' && !Number.isNaN(Date.parse(d.length === 7 ? `${d}-01` : d)));
  if (!valid.length) return undefined;
  return valid.sort((a, b) => Date.parse(b.length === 7 ? `${b}-01` : b) - Date.parse(a.length === 7 ? `${a}-01` : a))[0];
}

async function pMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./, '')}${p === '/' ? '' : p}`;
  } catch {
    return url.slice(0, 40);
  }
}

// ---------- the CLI wrapper ----------

interface Ask {
  model: string;
  prompt: string;
  timeoutMs?: number;
  allowedTools?: string[];
  maxTurns?: number;
}

/** One skill-crew call, parsed as JSON, retried once with a "JSON only" nudge. */
async function askJson<T>(ask: Ask): Promise<T> {
  const call = (prompt: string) =>
    callClaude({
      task: 'skill',
      model: ask.model,
      prompt,
      timeoutMs: ask.timeoutMs ?? CREW_TIMEOUT_MS,
      ...(ask.allowedTools ? { allowedTools: ask.allowedTools } : {}),
      ...(ask.maxTurns ? { maxTurns: ask.maxTurns } : {}),
    });
  const first = await call(ask.prompt);
  try {
    return extractJson<T>(first);
  } catch {
    const second = await call(`${ask.prompt}\n\n${prompts.JSON_NUDGE}`);
    return extractJson<T>(second);
  }
}

async function skillModels() {
  const settings = await getSettings();
  return settings.skillModels ?? {
    cartographer: 'opus', scout: 'opus', assessor: 'opus', reconciler: 'opus', architect: 'opus', panel: 'sonnet', freshness: 'haiku',
  };
}

// ---------- cartographer ----------

/** Two passes: draft the map, then let a skeptical practitioner merge in what is missing. */
export async function runCartographer(name: string, frame: Frame): Promise<AngleMap> {
  if (isMock()) return fixtures.mockMap(frame);
  const models = await skillModels();
  const draft = await askJson<unknown>({
    model: models.cartographer,
    prompt: prompts.cartographerPrompt(name, frame),
    timeoutMs: CARTO_TIMEOUT_MS,
  });
  const first = coerceAngleMap(draft);
  try {
    const merged = await askJson<unknown>({
      model: models.cartographer,
      prompt: prompts.cartographerCritiquePrompt(name, frame, first),
      timeoutMs: CARTO_TIMEOUT_MS,
    });
    const second = coerceAngleMap(merged);
    if (second.angles.length >= 4) return second;
  } catch {
    // The critique pass is a bonus; the first map still stands on its own.
  }
  return first;
}

// ---------- scouting ----------

interface ScoutSource {
  url: string; kind: SourceKind; title: string; date?: string; why?: string; quote?: string; hasRealNumbers: boolean;
}
interface ScoutClaim { text: string; sourceUrls: string[]; quote?: string }
interface ScoutResult { angleId: string; sources: ScoutSource[]; claims: ScoutClaim[]; error?: string }

export function coerceScout(raw: unknown, angleId: string): ScoutResult {
  const r = (raw ?? {}) as { sources?: unknown[]; claims?: unknown[] };
  const sources: ScoutSource[] = [];
  const byUrl = new Map<string, ScoutSource>();
  for (const item of Array.isArray(r.sources) ? r.sources : []) {
    const s = (item ?? {}) as Partial<ScoutSource>;
    const url = typeof s.url === 'string' ? s.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const key = normalizeUrl(url);
    if (byUrl.has(key)) continue;
    const kind = SOURCE_KINDS.has(s.kind as SourceKind) && s.kind !== 'user' ? (s.kind as SourceKind) : guessSourceKind(url);
    const entry: ScoutSource = {
      url,
      kind,
      title: (typeof s.title === 'string' && s.title.trim() ? s.title.trim() : shortUrl(url)).slice(0, 160),
      hasRealNumbers: s.hasRealNumbers === true,
    };
    const date = typeof s.date === 'string' ? s.date.trim().slice(0, 10) : '';
    if (/^\d{4}(-\d{2}){0,2}$/.test(date)) entry.date = date;
    if (typeof s.why === 'string' && s.why.trim()) entry.why = s.why.trim().slice(0, 240);
    if (typeof s.quote === 'string' && s.quote.trim()) entry.quote = s.quote.trim().slice(0, 600);
    byUrl.set(key, entry);
    sources.push(entry);
    if (sources.length >= 12) break;
  }
  const known = new Set([...byUrl.keys()]);
  const claims: ScoutClaim[] = [];
  for (const item of Array.isArray(r.claims) ? r.claims : []) {
    const c = (item ?? {}) as Partial<ScoutClaim>;
    const text = typeof c.text === 'string' ? c.text.trim().replace(/\s+/g, ' ').slice(0, 400) : '';
    if (text.length < 12) continue;
    const urls = (Array.isArray(c.sourceUrls) ? c.sourceUrls : [])
      .filter((u): u is string => typeof u === 'string')
      .map(normalizeUrl)
      .filter((u) => known.has(u));
    if (!urls.length) continue;
    const entry: ScoutClaim = { text, sourceUrls: [...new Set(urls)] };
    if (typeof c.quote === 'string' && c.quote.trim()) entry.quote = c.quote.trim().slice(0, 600);
    claims.push(entry);
    if (claims.length >= 14) break;
  }
  return { angleId, sources, claims };
}

async function phaseScouting(ctl: JobCtl, project: SkillProject, map: AngleMap): Promise<void> {
  const targets = scoutTargets(map);
  const models = await skillModels();
  await ctl.progress({ anglesKept: targets.length, anglesDone: 0 });

  let failures = 0;
  await pMap(targets, SCOUT_PARALLEL, async (angle) => {
    ctl.checkpoint();
    const file = scoutFile(project.id, angle.id);
    if (await exists(file)) {
      await ctl.bump('anglesDone');
      return;
    }
    const siblings = targets.filter((t) => t.id !== angle.id).map((t) => t.title).slice(0, 12);
    try {
      const raw = await askJson<unknown>({
        model: models.scout,
        prompt: prompts.scoutPrompt({ name: project.name, frame: project.frame, angle, siblings }),
        allowedTools: ['WebSearch', 'WebFetch'],
        // The prompt budgets ~18 tool calls; the cap only catches a runaway.
        maxTurns: 40,
        timeoutMs: SCOUT_TIMEOUT_MS,
      });
      const result = coerceScout(raw, angle.id);
      await writeJson(file, result);
      await ctl.log(`scout: '${angle.title}' found ${plural(result.sources.length, 'source')}, ${plural(result.claims.length, 'claim')}`);
    } catch (err) {
      failures += 1;
      const why = err instanceof Error ? err.message.slice(0, 140) : 'scout failed';
      await writeJson(file, { angleId: angle.id, sources: [], claims: [], error: why } satisfies ScoutResult);
      await ctl.log(`scout: '${angle.title}' came back empty — ${why}`);
    }
    await ctl.bump('anglesDone');
  });

  if (targets.length && failures === targets.length) {
    throw new Error('every scout failed — check that the claude CLI can reach the web, then start research again');
  }
}

async function readScouts(id: string, targets: Angle[]): Promise<ScoutResult[]> {
  const out: ScoutResult[] = [];
  for (const angle of targets) {
    const r = await readJson<ScoutResult>(scoutFile(id, angle.id));
    if (r) out.push({ ...r, angleId: angle.id });
  }
  return out;
}

// ---------- enriching ----------

/** Merge every scout's sources into one deduped corpus, ids s1..sN. */
export function mergeSources(scouts: ScoutResult[]): SourceRef[] {
  const byUrl = new Map<string, SourceRef>();
  for (const scout of scouts) {
    for (const s of scout.sources) {
      const key = normalizeUrl(s.url);
      const existing = byUrl.get(key);
      if (existing) {
        if (!existing.angleIds.includes(scout.angleId)) existing.angleIds.push(scout.angleId);
        existing.hasRealNumbers = existing.hasRealNumbers || s.hasRealNumbers;
        if (!existing.quote && s.quote) existing.quote = s.quote;
        if (!existing.date && s.date) existing.date = s.date;
        continue;
      }
      const ref: SourceRef = {
        id: '',
        url: s.url,
        kind: s.kind,
        title: s.title,
        angleIds: [scout.angleId],
        reputation: KIND_PRIOR[s.kind] ?? 0.4,
        soundness: 0.5,
        hasRealNumbers: s.hasRealNumbers,
        fetched: 'failed',
      };
      if (s.date) ref.date = s.date;
      if (s.quote) ref.quote = s.quote;
      byUrl.set(key, ref);
    }
  }
  return [...byUrl.values()].map((ref, i) => ({ ...ref, id: `s${i + 1}` }));
}

async function phaseEnriching(ctl: JobCtl, project: SkillProject, map: AngleMap): Promise<SourceRef[]> {
  const scouts = await readScouts(project.id, scoutTargets(map));
  const sources = mergeSources(scouts);
  await ctl.progress({ sources: sources.length });
  await ctl.log(`enrich: ${plural(sources.length, 'unique source')} to read`);

  await pMap(sources, ENRICH_PARALLEL, async (source) => {
    ctl.checkpoint();
    const outcome = await enrichSource(project.id, source);
    source.fetched = outcome.fetched;
    await ctl.log(`enrich: ${shortUrl(source.url)} ${outcome.note ?? outcome.fetched}`);
  });

  await writeJson(enrichedFile(project.id), sources);
  return sources;
}

// ---------- assessing ----------

interface DraftClaim {
  key: string;
  text: string;
  angleId: string;
  sourceIds: string[];
  contextTags: string[];
}

async function textFor(skillId: string, source: SourceRef): Promise<string> {
  const cached = await fsp.readFile(sourceTextFile(skillId, source.id), 'utf8').catch(() => '');
  return cached || source.quote || '';
}

async function phaseAssessing(ctl: JobCtl, project: SkillProject, map: AngleMap): Promise<{ sources: SourceRef[]; claims: DraftClaim[] }> {
  const models = await skillModels();
  const sources = (await readJson<SourceRef[]>(enrichedFile(project.id))) ?? [];
  const angleTitle = new Map(map.angles.map((a) => [a.id, a.title]));

  for (const batch of chunk(sources, ASSESS_BATCH)) {
    ctl.checkpoint();
    const items = await Promise.all(batch.map(async (s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      url: s.url,
      ...(s.date ? { date: s.date } : {}),
      angle: angleTitle.get(s.angleIds[0] ?? '') ?? s.angleIds[0] ?? 'general',
      text: await textFor(project.id, s),
    })));
    try {
      const scored = await askJson<{ sources?: Array<Partial<SourceRef> & { id?: string }> }>({
        model: models.assessor,
        prompt: prompts.assessSourcesPrompt(items),
      });
      const byId = new Map(batch.map((s) => [s.id, s]));
      for (const row of scored.sources ?? []) {
        const target = byId.get(String(row?.id ?? ''));
        if (!target) continue;
        target.reputation = clamp01(row.reputation, target.reputation);
        target.soundness = clamp01(row.soundness, target.soundness);
        if (typeof row.hasRealNumbers === 'boolean') target.hasRealNumbers = row.hasRealNumbers;
        if (typeof row.note === 'string' && row.note.trim()) target.note = row.note.trim().slice(0, 200);
        if (!target.date && typeof row.date === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(row.date.trim())) target.date = row.date.trim();
      }
      await ctl.log(`assess: scored ${plural(batch.length, 'source')}`);
    } catch (err) {
      await ctl.log(`assess: batch fell back to kind priors — ${(err as Error).message.slice(0, 100)}`);
    }
  }
  // User-pasted sources are the learner's, not the crew's: never overwrite them.
  const pasted = (await loadSources(project.id)).filter((s) => s.kind === 'user');
  await saveSources(project.id, [...sources, ...pasted]);

  // Candidate claims out of the scout files, deduped on their text.
  const scouts = await readScouts(project.id, scoutTargets(map));
  const byUrlId = new Map(sources.map((s) => [normalizeUrl(s.url), s.id]));
  const drafts: DraftClaim[] = [];
  const seen = new Set<string>();
  for (const scout of scouts) {
    for (const c of scout.claims) {
      const key = c.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 90);
      if (seen.has(key)) continue;
      const sourceIds = c.sourceUrls.map((u) => byUrlId.get(u)).filter((x): x is string => Boolean(x));
      if (!sourceIds.length) continue;
      seen.add(key);
      drafts.push({ key, text: c.text, angleId: scout.angleId, sourceIds: [...new Set(sourceIds)], contextTags: [] });
    }
  }

  const kindOf = new Map(sources.map((s) => [s.id, s.kind]));
  for (const batch of chunk(drafts, TAG_BATCH)) {
    ctl.checkpoint();
    const items = batch.map((c, i) => ({
      i,
      text: c.text,
      angle: angleTitle.get(c.angleId) ?? c.angleId,
      kinds: [...new Set(c.sourceIds.map((id) => kindOf.get(id)).filter((k): k is SourceKind => Boolean(k)))],
    }));
    try {
      const tagged = await askJson<{ claims?: Array<{ i?: number; text?: string; contextTags?: unknown; drop?: boolean }> }>({
        model: models.assessor,
        prompt: prompts.tagClaimsPrompt(project.name, project.frame, items),
      });
      for (const row of tagged.claims ?? []) {
        const target = batch[Number(row?.i)];
        if (!target) continue;
        if (row.drop === true) { target.text = ''; continue; }
        if (typeof row.text === 'string' && row.text.trim().length > 12) target.text = row.text.trim().slice(0, 400);
        target.contextTags = (Array.isArray(row.contextTags) ? row.contextTags : [])
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().toLowerCase().slice(0, 24))
          .slice(0, 4);
      }
    } catch (err) {
      await ctl.log(`assess: claim tagging skipped — ${(err as Error).message.slice(0, 100)}`);
    }
  }

  const kept = drafts.filter((c) => c.text);
  await writeJson(draftClaimsFile(project.id), kept);
  await ctl.progress({ claims: kept.length });
  await ctl.log(`assess: ${plural(sources.length, 'source')} scored, ${plural(kept.length, 'candidate claim')}`);
  return { sources, claims: kept };
}

function clamp01(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

// ---------- reconciling ----------

interface Cluster {
  text?: string; angleId?: string; sourceIds?: unknown; contested?: boolean; sides?: { for?: unknown; against?: unknown };
}

async function phaseReconciling(ctl: JobCtl, project: SkillProject, map: AngleMap): Promise<Claim[]> {
  const models = await skillModels();
  const sources = await loadSources(project.id);
  const drafts = (await readJson<DraftClaim[]>(draftClaimsFile(project.id))) ?? [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const angleById = new Map(map.angles.map((a) => [a.id, a]));

  const clusters: Cluster[] = [];
  for (const batch of chunk(drafts, RECONCILE_BATCH)) {
    ctl.checkpoint();
    const items = batch.map((c, i) => ({ i, text: c.text, angleId: c.angleId, sourceIds: c.sourceIds }));
    try {
      const out = await askJson<{ claims?: Cluster[] }>({
        model: models.reconciler,
        prompt: prompts.reconcilerPrompt(items, sources),
      });
      clusters.push(...(Array.isArray(out.claims) ? out.claims : []));
    } catch (err) {
      await ctl.log(`reconcile: batch kept as-is — ${(err as Error).message.slice(0, 100)}`);
      clusters.push(...batch.map((c) => ({ text: c.text, angleId: c.angleId, sourceIds: c.sourceIds })));
    }
  }

  const tagsFor = new Map(drafts.map((d) => [d.key, d.contextTags]));
  // A reworded cluster loses its key, so fall back to the tags of the drafts it shares sources with.
  const tagsBySource = new Map<string, string[]>();
  for (const d of drafts) for (const sid of d.sourceIds) tagsBySource.set(sid, [...(tagsBySource.get(sid) ?? []), ...d.contextTags]);
  const claims: Claim[] = [];
  let contestedCount = 0;
  for (const cluster of clusters) {
    const text = typeof cluster.text === 'string' ? cluster.text.trim().replace(/\s+/g, ' ').slice(0, 400) : '';
    if (text.length < 12) continue;
    const sourceIds = [...new Set((Array.isArray(cluster.sourceIds) ? cluster.sourceIds : [])
      .filter((x): x is string => typeof x === 'string' && byId.has(x)))];
    if (!sourceIds.length) continue;
    const angleId = typeof cluster.angleId === 'string' && angleById.has(cluster.angleId)
      ? cluster.angleId
      : (byId.get(sourceIds[0])?.angleIds[0] ?? map.angles[0]?.id ?? 'general');
    const angle = angleById.get(angleId);
    const horizon = horizonMonths(angle);
    const refs = sourceIds.map((id) => byId.get(id)!).filter(Boolean);
    const newest = newestDate(refs.map((s) => s.date));
    const sides = cluster.contested === true
      ? {
          for: (Array.isArray(cluster.sides?.for) ? cluster.sides!.for : []).filter((x): x is string => typeof x === 'string' && sourceIds.includes(x)),
          against: (Array.isArray(cluster.sides?.against) ? cluster.sides!.against : []).filter((x): x is string => typeof x === 'string' && sourceIds.includes(x)),
        }
      : undefined;
    const contested = Boolean(sides && sides.against.length > 0);
    if (contested) contestedCount += 1;
    const stale = isStale(newest, angle);
    const confidence = claimConfidence({
      reputations: refs.map((s) => s.reputation),
      soundnesses: refs.map((s) => s.soundness),
      ...(newest ? { newest } : {}),
      horizon,
      consensus: sourceIds.length,
      contested,
    });
    if (confidence < MIN_CONFIDENCE) continue;
    const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 90);
    const claim: Claim = {
      id: `c${claims.length + 1}`,
      angleId,
      text,
      verdict: verdictFor(confidence, { contested, stale, sources: sourceIds.length }),
      confidence,
      sourceIds,
      contextTags: tagsFor.get(key) ?? [...new Set(sourceIds.flatMap((sid) => tagsBySource.get(sid) ?? []))].slice(0, 4),
      consensus: consensusFrom(sourceIds, sides, (id) => byId.get(id)?.kind),
    };
    if (newest) claim.newest = newest;
    if (contested && sides) claim.sides = { for: sides.for.length ? sides.for : sourceIds.filter((id) => !sides.against.includes(id)), against: sides.against };
    claims.push(claim);
  }

  await saveClaims(project.id, claims);
  await ctl.progress({ claims: claims.length });
  await ctl.log(`reconcile: ${plural(claims.length, 'claim')}, ${contestedCount} contested`);
  return claims;
}

// ---------- architecting ----------

function coerceConcepts(raw: unknown): Concept[] {
  const out: Concept[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const c = (item ?? {}) as Partial<Concept>;
    const label = typeof c.label === 'string' ? c.label.trim().slice(0, 160) : '';
    if (!label) continue;
    let id = slugify(String(c.id ?? label), 'concept');
    let n = 2;
    while (seen.has(id)) id = `${id}-${n++}`;
    seen.add(id);
    out.push({ id, label, mastery: 0, cleared: false, source: 'unseen' });
    if (out.length >= 4) break;
  }
  return out;
}

function coerceUnits(raw: unknown, moduleId: string, conceptIds: Set<string>, usedIds: Set<string>): PrimerUnit[] {
  const out: PrimerUnit[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const u = (item ?? {}) as Record<string, unknown>;
    const conceptId = String(u.conceptId ?? '');
    if (!conceptIds.has(conceptId)) continue;
    let id = slugify(String(u.id ?? `${moduleId}-u${out.length + 1}`), `${moduleId}-u`);
    if (!id.startsWith(moduleId)) id = `${moduleId}-${id}`;
    let n = 2;
    while (usedIds.has(id)) id = `${id}-${n++}`;
    usedIds.add(id);
    if (u.kind === 'check') {
      const options = (Array.isArray(u.options) ? u.options : [])
        .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        .map((o) => o.trim().slice(0, 120))
        .slice(0, 4);
      const question = typeof u.question === 'string' ? u.question.trim().slice(0, 240) : '';
      if (options.length < 2 || !question) continue;
      const answerIndex = Math.min(options.length - 1, Math.max(0, Math.round(Number(u.answerIndex ?? 0)) || 0));
      out.push({ kind: 'check', id, conceptId, question, options, answerIndex, explain: String(u.explain ?? '').trim().slice(0, 240) });
    } else {
      const bodyMd = typeof u.bodyMd === 'string' ? u.bodyMd.trim() : '';
      if (!bodyMd) continue;
      out.push({ kind: 'card', id, conceptId, title: String(u.title ?? '').trim().slice(0, 80) || 'Card', bodyMd: capWords(bodyMd, 140) });
    }
  }
  return out;
}

function capWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  return words.length <= max ? text : `${words.slice(0, max).join(' ')}…`;
}

function coerceRubric(raw: unknown, moduleId: string, claimIds: Set<string>): RubricItem[] {
  const out: RubricItem[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = (item ?? {}) as Partial<RubricItem>;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 80) : '';
    if (!label) continue;
    let id = slugify(String(r.id ?? `r-${label}`), `r-${moduleId}`);
    let n = 2;
    while (seen.has(id)) id = `${id}-${n++}`;
    seen.add(id);
    out.push({
      id,
      label,
      claimIds: (Array.isArray(r.claimIds) ? r.claimIds : []).filter((c): c is string => typeof c === 'string' && claimIds.has(c)),
      weight: Math.min(3, Math.max(1, Math.round(Number(r.weight ?? 1)) || 1)),
    });
    if (out.length >= 5) break;
  }
  return out;
}

interface DrillCtx {
  moduleId: string;
  claimIds: Set<string>;
  rubricIds: Set<string>;
  numberSourceIds: Set<string>;
  personaIds: string[];
  usedIds: Set<string>;
}

export function coerceDrills(raw: unknown, ctx: DrillCtx): Drill[] {
  const out: Drill[] = [];
  const keepClaims = (v: unknown) => (Array.isArray(v) ? v : []).filter((c): c is string => typeof c === 'string' && ctx.claimIds.has(c));
  const keepRubrics = (v: unknown) => {
    const list = (Array.isArray(v) ? v : []).filter((r): r is string => typeof r === 'string' && ctx.rubricIds.has(r));
    return list.length ? list : [...ctx.rubricIds];
  };
  for (const item of Array.isArray(raw) ? raw : []) {
    const d = (item ?? {}) as Record<string, unknown>;
    let id = slugify(String(d.id ?? `${ctx.moduleId}-${String(d.kind)}`), `${ctx.moduleId}-drill`);
    let n = 2;
    while (ctx.usedIds.has(id)) id = `${id}-${n++}`;

    if (d.kind === 'predict') {
      const options = (Array.isArray(d.options) ? d.options : []).filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 2);
      const sourceId = String(d.sourceId ?? '');
      // A predict drill must quote a real documented result, never an invented one.
      if (options.length !== 2 || !ctx.numberSourceIds.has(sourceId)) continue;
      const prompt = String(d.prompt ?? '').trim();
      const result = String(d.result ?? '').trim();
      if (!prompt || !result) continue;
      ctx.usedIds.add(id);
      out.push({
        kind: 'predict', id, moduleId: ctx.moduleId, prompt, options: [options[0], options[1]],
        winner: Number(d.winner) === 1 ? 1 : 0, result, why: String(d.why ?? '').trim().slice(0, 240),
        claimIds: keepClaims(d.claimIds), sourceId,
      });
    } else if (d.kind === 'sprint') {
      const prompt = String(d.prompt ?? '').trim();
      if (!prompt || !ctx.rubricIds.size) continue;
      ctx.usedIds.add(id);
      out.push({
        kind: 'sprint', id, moduleId: ctx.moduleId, prompt,
        quota: Math.min(8, Math.max(1, Math.round(Number(d.quota ?? 3)) || 3)),
        seconds: Math.min(300, Math.max(30, Math.round(Number(d.seconds ?? 60)) || 60)),
        rubricIds: keepRubrics(d.rubricIds),
      });
    } else if (d.kind === 'spot') {
      const segments = (Array.isArray(d.segments) ? d.segments : [])
        .map((s) => (s ?? {}) as Record<string, unknown>)
        .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
        .map((s) => {
          const seg: { text: string; flaw?: string; claimIds?: string[] } = { text: String(s.text).trim().slice(0, 400) };
          if (typeof s.flaw === 'string' && s.flaw.trim()) {
            seg.flaw = s.flaw.trim().slice(0, 240);
            seg.claimIds = keepClaims(s.claimIds);
          }
          return seg;
        })
        .slice(0, 8);
      if (segments.length < 3 || segments.filter((s) => s.flaw).length !== 1) continue;
      ctx.usedIds.add(id);
      out.push({ kind: 'spot', id, moduleId: ctx.moduleId, segments });
    } else if (d.kind === 'rewrite') {
      const original = String(d.original ?? '').trim();
      if (!original || ctx.personaIds.length < 2 || !ctx.rubricIds.size) continue;
      const from = ctx.personaIds.includes(String(d.fromPersona)) ? String(d.fromPersona) : ctx.personaIds[0];
      let to = ctx.personaIds.includes(String(d.toPersona)) ? String(d.toPersona) : ctx.personaIds[1];
      if (to === from) to = ctx.personaIds.find((p) => p !== from) ?? ctx.personaIds[1];
      ctx.usedIds.add(id);
      out.push({ kind: 'rewrite', id, moduleId: ctx.moduleId, original: original.slice(0, 800), fromPersona: from, toPersona: to, rubricIds: keepRubrics(d.rubricIds) });
    }
  }
  return out;
}

async function phaseArchitecting(ctl: JobCtl, project: SkillProject, map: AngleMap): Promise<Course> {
  const models = await skillModels();
  const sources = await loadSources(project.id);
  const claims = await loadClaims(project.id);
  if (!claims.length) throw new Error('no claims survived reconciliation — start research again to re-scout');
  const angles = map.angles.filter((a) => a.kept);
  const ctx = { name: project.name, frame: project.frame, angles, claims };
  const claimIds = new Set(claims.map((c) => c.id));
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const plan = await askJson<{ modules?: Array<{ id?: string; title?: string; angleIds?: unknown }> }>({
    model: models.architect,
    prompt: prompts.architectPlanPrompt(ctx),
  });
  const planned = (Array.isArray(plan.modules) ? plan.modules : [])
    .map((m, i) => ({
      id: slugify(String(m?.id ?? m?.title ?? `module-${i + 1}`), `module-${i + 1}`),
      title: String(m?.title ?? '').trim().slice(0, 60) || `Module ${i + 1}`,
      angleIds: (Array.isArray(m?.angleIds) ? m!.angleIds : []).filter((a): a is string => typeof a === 'string' && angles.some((x) => x.id === a)),
    }))
    .slice(0, 6);
  if (!planned.length) throw new Error('the architect planned no modules — start research again');
  await ctl.log(`architect: ${plural(planned.length, 'module')} planned`);

  // Personas first: the rewrite drills reference them by id.
  const extras = await askJson<{ personas?: unknown; exemplars?: unknown; metric?: unknown }>({
    model: models.architect,
    prompt: prompts.architectExtrasPrompt(ctx, sources),
  });
  const personas: Persona[] = (Array.isArray(extras.personas) ? extras.personas : [])
    .map((item, i) => {
      const p = (item ?? {}) as Partial<Persona>;
      const name = String(p.name ?? '').trim().slice(0, 60);
      if (!name) return null;
      return {
        id: slugify(String(p.id ?? name.split(/[ ,]/)[0]), `persona-${i + 1}`),
        name,
        role: String(p.role ?? '').trim().slice(0, 120),
        bio: String(p.bio ?? '').trim().slice(0, 400),
        sourceIds: (Array.isArray(p.sourceIds) ? p.sourceIds : []).filter((s): s is string => typeof s === 'string' && sourceById.has(s)),
      } satisfies Persona;
    })
    .filter((p): p is Persona => Boolean(p))
    .slice(0, 3);
  const exemplars = (Array.isArray(extras.exemplars) ? extras.exemplars : [])
    .map((item, i) => {
      const e = (item ?? {}) as Record<string, unknown>;
      const body = String(e.body ?? '').trim();
      if (!body) return null;
      const out: Course['exemplars'][number] = {
        id: slugify(String(e.id ?? `x${i + 1}`), `x${i + 1}`),
        title: String(e.title ?? '').trim().slice(0, 80) || `Example ${i + 1}`,
        body: body.slice(0, 2000),
        why: String(e.why ?? '').trim().slice(0, 300),
      };
      if (typeof e.sourceId === 'string' && sourceById.has(e.sourceId)) out.sourceId = e.sourceId;
      return out;
    })
    .filter((e): e is Course['exemplars'][number] => Boolean(e))
    .slice(0, 3);
  const rawMetric = (extras.metric ?? {}) as Record<string, unknown>;
  const metric = {
    name: String(rawMetric.name ?? 'reply rate').trim().slice(0, 40) || 'reply rate',
    unit: String(rawMetric.unit ?? '%').trim().slice(0, 12) || '%',
    corpusMedian: Number.isFinite(Number(rawMetric.corpusMedian)) ? Number(rawMetric.corpusMedian) : 0,
  };

  const usedUnitIds = new Set<string>();
  const usedDrillIds = new Set<string>();
  const modules: SkillModule[] = [];
  for (const [i, m] of planned.entries()) {
    ctl.checkpoint();
    const moduleClaims = claims.filter((c) => m.angleIds.includes(c.angleId));
    const pool = moduleClaims.length ? moduleClaims : claims;
    const numberSources = sources.filter((s) => s.hasRealNumbers && s.angleIds.some((a) => m.angleIds.includes(a)));
    const built = await askJson<Record<string, unknown>>({
      model: models.architect,
      prompt: prompts.architectModulePrompt({
        ...ctx,
        moduleId: m.id,
        moduleTitle: m.title,
        moduleClaims: pool,
        numberSources: numberSources.map((s) => ({ id: s.id, title: s.title, url: s.url, ...(s.quote ? { quote: s.quote } : {}) })),
        personaHint: personas.map((p) => `${p.id} (${p.name})`),
      }),
    });

    const concepts = coerceConcepts(built.concepts);
    if (!concepts.length) continue;
    const conceptIds = new Set(concepts.map((c) => c.id));
    const units = coerceUnits(built.units, m.id, conceptIds, usedUnitIds);
    const poolIds = new Set(pool.map((c) => c.id));
    const rubric = coerceRubric(built.rubric, m.id, claimIds);
    const unitIds = new Set(units.map((u) => u.id));
    const unitClaims: Record<string, string[]> = {};
    for (const [unitId, list] of Object.entries((built.unitClaims ?? {}) as Record<string, unknown>)) {
      if (!unitIds.has(unitId)) continue;
      const kept = (Array.isArray(list) ? list : []).filter((c): c is string => typeof c === 'string' && claimIds.has(c));
      if (kept.length) unitClaims[unitId] = kept;
    }
    const drills = coerceDrills(built.drills, {
      moduleId: m.id,
      claimIds: poolIds,
      rubricIds: new Set(rubric.map((r) => r.id)),
      numberSourceIds: new Set(numberSources.map((s) => s.id)),
      personaIds: personas.map((p) => p.id),
      usedIds: usedDrillIds,
    });

    modules.push({
      id: m.id,
      title: m.title,
      angleIds: m.angleIds,
      concepts,
      units: units as SkillModule['units'],
      unitClaims,
      drills,
      rubric,
      status: i === 0 ? 'current' : 'todo',
    });
    await ctl.progress({ modules: modules.length });
    await ctl.log(`architect: '${m.title}' — ${plural(units.length, 'unit')}, ${plural(drills.length, 'drill')}, ${plural(rubric.length, 'rubric item')}`);
  }
  if (!modules.length) throw new Error('the architect produced no usable modules — start research again');

  const course: Course = { modules, personas, exemplars, metric };
  await saveCourse(project.id, course);
  return course;
}

// ---------- mock pipeline ----------

async function runMock(ctl: JobCtl, project: SkillProject): Promise<void> {
  const map = (await loadMap(project.id)) ?? fixtures.mockMap(project.frame);
  await ctl.setPhase('cartography');
  await saveMap(project.id, map);
  await sleep(MOCK_TICK);
  const targets = scoutTargets(map);
  await ctl.progress({ anglesKept: targets.length, anglesDone: 0, sources: 0, claims: 0, modules: 0 });
  await ctl.log(`cartographer: ${plural(map.angles.length, 'angle')}, ${targets.length} to scout`);

  await ctl.setPhase('scouting');
  const sources = fixtures.mockSources();
  for (const angle of targets) {
    ctl.checkpoint();
    await sleep(60);
    const hits = sources.filter((s) => s.angleIds.includes(angle.id));
    const found = hits.length || 2;
    // Same per-angle artifact the real scouts write, so resume behaves identically.
    await writeJson(scoutFile(project.id, angle.id), {
      angleId: angle.id,
      sources: hits.map((s) => ({ url: s.url, kind: s.kind, title: s.title, hasRealNumbers: s.hasRealNumbers, ...(s.date ? { date: s.date } : {}), ...(s.quote ? { quote: s.quote } : {}) })),
      claims: [],
    });
    await ctl.log(`scout: '${angle.title}' found ${plural(found, 'source')}`);
    await ctl.bump('anglesDone');
  }

  await ctl.setPhase('enriching');
  await ctl.progress({ sources: sources.length });
  for (const s of sources) {
    ctl.checkpoint();
    await sleep(40);
    await ctl.log(`enrich: ${shortUrl(s.url)} ${s.fetched === 'full' ? 'full text' : 'snippet only'}`);
  }
  await writeJson(enrichedFile(project.id), sources);

  await ctl.setPhase('assessing');
  await sleep(MOCK_TICK);
  await saveSources(project.id, [...sources, ...(await loadSources(project.id)).filter((s) => s.kind === 'user')]);
  const claims = fixtures.mockClaims();
  await writeJson(draftClaimsFile(project.id), claims.map((c) => ({ key: c.id, text: c.text, angleId: c.angleId, sourceIds: c.sourceIds, contextTags: c.contextTags })));
  await ctl.progress({ claims: claims.length });
  await ctl.log(`assess: ${plural(sources.length, 'source')} scored, ${plural(claims.length, 'candidate claim')}`);

  await ctl.setPhase('reconciling');
  await sleep(MOCK_TICK);
  await saveClaims(project.id, claims);
  await ctl.log(`reconcile: ${plural(claims.length, 'claim')}, ${claims.filter((c) => c.verdict === 'contested').length} contested`);

  await ctl.setPhase('architecting');
  await sleep(MOCK_TICK);
  const course = fixtures.mockCourse();
  await saveCourse(project.id, course);
  for (const m of course.modules) {
    await ctl.progress({ modules: course.modules.indexOf(m) + 1 });
    await ctl.log(`architect: '${m.title}' — ${plural(m.units.length, 'unit')}, ${plural(m.drills.length, 'drill')}, ${plural(m.rubric.length, 'rubric item')}`);
  }

  project.map = map;
  project.course = course;
  project.phase = 'calibrating';
  await saveSkill(project);
}

// ---------- the real pipeline ----------

async function presence(id: string, map: AngleMap | null): Promise<ArtifactPresence> {
  const targets = scoutTargets(map ?? undefined);
  let scouts = targets.length > 0;
  for (const t of targets) if (!(await exists(scoutFile(id, t.id)))) { scouts = false; break; }
  return {
    map: Boolean(map),
    scouts,
    enriched: await exists(enrichedFile(id)),
    assessed: (await exists(draftClaimsFile(id))) && (await exists(path.join(researchDir(id), 'sources.json'))),
    reconciled: await exists(path.join(researchDir(id), 'claims.json')),
    architected: await exists(courseFileOf(id)),
  };
}

async function runReal(ctl: JobCtl, project: SkillProject): Promise<void> {
  let map = await loadMap(project.id);
  if (!map) {
    await ctl.setPhase('cartography');
    await ctl.log('cartographer: mapping the skill');
    map = await runCartographer(project.name, project.frame);
    await saveMap(project.id, map);
    project.map = map;
    await saveSkill(project);
    await ctl.log(`cartographer: ${plural(map.angles.length, 'angle')}`);
  }
  project.map = map;

  const where = await presence(project.id, map);
  await ctl.progress({ anglesKept: scoutTargets(map).length });

  if (!where.scouts) {
    await ctl.setPhase('scouting');
    await phaseScouting(ctl, project, map);
  } else {
    await ctl.progress({ anglesDone: scoutTargets(map).length });
  }

  ctl.checkpoint();
  if (!where.enriched || !where.scouts) {
    await ctl.setPhase('enriching');
    await phaseEnriching(ctl, project, map);
  }

  ctl.checkpoint();
  if (!where.assessed || !where.enriched || !where.scouts) {
    await ctl.setPhase('assessing');
    await phaseAssessing(ctl, project, map);
  }

  ctl.checkpoint();
  if (!where.reconciled || !where.assessed || !where.enriched || !where.scouts) {
    await ctl.setPhase('reconciling');
    await phaseReconciling(ctl, project, map);
  }

  ctl.checkpoint();
  await ctl.setPhase('architecting');
  const course = await phaseArchitecting(ctl, project, map);

  project.course = course;
  project.phase = 'calibrating';
  await saveSkill(project);
}

// ---------- entry points ----------

/** Start or resume the research job. Idempotent: a running job is returned as-is. */
export async function startResearch(project: SkillProject): Promise<ResearchJob> {
  if (isRunning(project.id)) return currentJob(project.id);

  const previous = await currentJob(project.id);
  const map = await loadMap(project.id);
  const where = await presence(project.id, map);
  if (resumeFrom(where) === 'done' && previous.phase === 'done') return previous;

  const seed: ResearchJob = {
    ...emptyJob(),
    phase: 'cartography',
    startedAt: previous.startedAt ?? new Date().toISOString(),
    progress: { ...previous.progress },
    log: previous.log.slice(-20),
  };
  if (previous.phase === 'failed' && previous.error) seed.log = [...seed.log, `retrying after: ${previous.error}`].slice(-50);

  return startJob(project.id, seed, async (ctl) => {
    if (isMock()) await runMock(ctl, project);
    else await runReal(ctl, project);
  });
}

/**
 * Freshness pass: re-check the newest material per angle and stale-stamp claims
 * whose newest source has fallen past that angle's decay horizon.
 */
export async function startRefresh(project: SkillProject): Promise<ResearchJob> {
  if (isRunning(project.id)) return currentJob(project.id);
  const map = (await loadMap(project.id)) ?? { angles: [] };
  const angleById = new Map(map.angles.map((a) => [a.id, a]));

  if (isMock()) {
    const claims = await loadClaims(project.id);
    for (const c of claims) if (isStale(c.newest, angleById.get(c.angleId))) c.verdict = 'stale';
    await saveClaims(project.id, claims);
    const stale = claims.filter((c) => c.verdict === 'stale').length;
    const at = new Date().toISOString();
    return publish(project.id, {
      ...emptyJob(),
      phase: 'done',
      startedAt: at,
      finishedAt: at,
      progress: { anglesKept: map.angles.length, anglesDone: map.angles.length, sources: (await loadSources(project.id)).length, claims: claims.length, modules: project.course?.modules.length ?? 0 },
      log: ['freshness: re-checking the newest sources', `freshness: ${plural(stale, 'claim')} past the horizon`, 'done.'],
    });
  }

  const seed: ResearchJob = { ...emptyJob(), phase: 'assessing', startedAt: new Date().toISOString(), log: ['freshness: re-checking the newest sources'] };

  return startJob(project.id, seed, async (ctl) => {
    const claims = await loadClaims(project.id);
    await ctl.progress({ claims: claims.length, anglesKept: map.angles.length });

    const models = await skillModels();
    const byAngle = new Map<string, Claim[]>();
    for (const c of claims) byAngle.set(c.angleId, [...(byAngle.get(c.angleId) ?? []), c]);

    for (const [angleId, group] of byAngle) {
      ctl.checkpoint();
      const angle = angleById.get(angleId);
      if (!angle) continue;
      try {
        const out = await askJson<{ claims?: Array<{ id?: string; newest?: string | null; stillHolds?: boolean }> }>({
          model: models.freshness,
          prompt: prompts.freshnessPrompt(project.name, angle, group),
          allowedTools: ['WebSearch'],
          maxTurns: 12,
        });
        const byId = new Map(group.map((c) => [c.id, c]));
        for (const row of out.claims ?? []) {
          const claim = byId.get(String(row?.id ?? ''));
          if (!claim) continue;
          if (typeof row.newest === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(row.newest.trim())) {
            const found = row.newest.trim();
            if (monthsSince(found) < monthsSince(claim.newest)) claim.newest = found;
          }
        }
        await ctl.log(`freshness: '${angle.title}' re-checked (${plural(group.length, 'claim')})`);
      } catch (err) {
        await ctl.log(`freshness: '${angle.title}' skipped — ${(err as Error).message.slice(0, 100)}`);
      }
      await ctl.bump('anglesDone');
    }

    let stale = 0;
    for (const c of claims) {
      if (isStale(c.newest, angleById.get(c.angleId))) { c.verdict = 'stale'; stale += 1; }
      else if (c.verdict === 'stale') c.verdict = c.confidence >= 0.8 ? 'solid' : 'likely';
    }
    await saveClaims(project.id, claims);
    await ctl.log(`freshness: ${plural(stale, 'claim')} past the horizon`);
  });
}
