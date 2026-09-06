// Skills-track storage: data/skills/<slug>/{project.json, research/, drafts.json,
// attempts.json, ships.json}. Path safety mirrors server/store.ts.
import path from 'node:path';
import type { SkillProject, ResearchJob, Claim, SourceRef, Course, AngleMap, Draft, DrillAttempt, Shipment } from '../../shared/skills';
import { HttpError, dataDir, ensureDir, readJson, writeJson, slugify } from '../store';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function skillsDir(): string { return path.join(dataDir(), 'skills'); }
export function skillDir(id: string): string {
  const raw = String(id ?? '');
  if (!ID_RE.test(raw) || raw.includes('..') || raw.length > 120) throw new HttpError(400, `invalid skill id: ${raw}`);
  return path.join(skillsDir(), raw);
}
export function researchDir(id: string): string { return path.join(skillDir(id), 'research'); }
export const projectFile = (id: string) => path.join(skillDir(id), 'project.json');
export const jobFile = (id: string) => path.join(researchDir(id), 'job.json');
export const mapFile = (id: string) => path.join(researchDir(id), 'map.json');
export const sourcesFile = (id: string) => path.join(researchDir(id), 'sources.json');
export const claimsFile = (id: string) => path.join(researchDir(id), 'claims.json');
export const courseFile = (id: string) => path.join(researchDir(id), 'course.json');
export const sourceTextFile = (id: string, sourceId: string) => path.join(researchDir(id), 'text', `${sourceId}.txt`);
export const draftsFile = (id: string) => path.join(skillDir(id), 'drafts.json');
export const attemptsFile = (id: string) => path.join(skillDir(id), 'attempts.json');
export const shipsFile = (id: string) => path.join(skillDir(id), 'ships.json');

export async function loadSkill(id: string): Promise<SkillProject> {
  const p = await readJson<SkillProject>(projectFile(id));
  if (!p) throw new HttpError(404, `no such skill project: ${id}`);
  return p;
}
export async function saveSkill(p: SkillProject): Promise<void> {
  await ensureDir(skillDir(p.id));
  await writeJson(projectFile(p.id), p);
}
export async function uniqueSkillId(name: string): Promise<string> {
  const base = slugify(name, 'skill');
  let id = base; let n = 2;
  while (await readJson(projectFile(id))) id = `${base}-${n++}`;
  return id;
}
export const loadJob = (id: string) => readJson<ResearchJob>(jobFile(id));
export const saveJob = (id: string, j: ResearchJob) => writeJson(jobFile(id), j);
export const loadMap = (id: string) => readJson<AngleMap>(mapFile(id));
export const saveMap = (id: string, m: AngleMap) => writeJson(mapFile(id), m);
export const loadSources = async (id: string) => (await readJson<SourceRef[]>(sourcesFile(id))) ?? [];
export const saveSources = (id: string, s: SourceRef[]) => writeJson(sourcesFile(id), s);
export const loadClaims = async (id: string) => (await readJson<Claim[]>(claimsFile(id))) ?? [];
export const saveClaims = (id: string, c: Claim[]) => writeJson(claimsFile(id), c);
export const loadCourse = (id: string) => readJson<Course>(courseFile(id));
export const saveCourse = (id: string, c: Course) => writeJson(courseFile(id), c);
export const loadDrafts = async (id: string) => (await readJson<Draft[]>(draftsFile(id))) ?? [];
export const saveDrafts = (id: string, d: Draft[]) => writeJson(draftsFile(id), d);
export const loadAttempts = async (id: string) => (await readJson<DrillAttempt[]>(attemptsFile(id))) ?? [];
export const saveAttempts = (id: string, a: DrillAttempt[]) => writeJson(attemptsFile(id), a);
export const loadShips = async (id: string) => (await readJson<Shipment[]>(shipsFile(id))) ?? [];
export const saveShips = (id: string, s: Shipment[]) => writeJson(shipsFile(id), s);
