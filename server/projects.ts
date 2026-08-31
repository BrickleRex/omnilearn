// Projects on disk: project.json plus the learner's real, runnable workspace files.

import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  Concept,
  FileNode,
  Milestone,
  Project,
  ProjectPlan,
  ProjectSummary,
} from '../shared/types';
import {
  HttpError,
  buildFileTree,
  ensureDir,
  exists,
  projectDir,
  projectsDir,
  readJson,
  resolveInProject,
  slugify,
  writeJson,
  writeTextFile,
} from './store';

/** The plan POSTed back by the client may carry the learner's original goal. */
type CreateBody = ProjectPlan & { goal?: string };

function projectFile(id: string): string {
  return path.join(projectDir(id), 'project.json');
}

export async function loadProject(id: string): Promise<Project> {
  const project = await readJson<Project>(projectFile(id));
  if (!project) throw new HttpError(404, `no such project: ${id}`);
  project.id = id; // folder name is the source of truth
  return project;
}

export async function saveProject(project: Project): Promise<void> {
  await writeJson(projectFile(project.id), project);
}

export function findMilestone(project: Project, milestoneId: string): Milestone {
  const m = project.milestones.find((x) => x.id === milestoneId);
  if (!m) throw new HttpError(404, `no such milestone: ${milestoneId}`);
  return m;
}

// ---------- creation ----------

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  for (let i = 2; i < 500; i++) {
    if (!(await exists(path.join(projectsDir(), candidate)))) return candidate;
    candidate = `${root}-${i}`;
  }
  throw new HttpError(409, 'could not allocate a project slug');
}

function conceptFromPlan(c: { id: string; label: string }): Concept {
  return {
    id: slugify(c.id, 'concept'),
    label: String(c.label ?? ''),
    mastery: 0,
    cleared: false,
    source: 'unseen',
  };
}

function validatePlan(body: unknown): CreateBody {
  const plan = body as CreateBody;
  if (!plan || typeof plan !== 'object') throw new HttpError(400, 'a ProjectPlan body is required');
  if (typeof plan.name !== 'string' || !plan.name.trim()) throw new HttpError(400, 'plan.name is required');
  if (!Array.isArray(plan.milestones) || plan.milestones.length === 0) {
    throw new HttpError(400, 'plan.milestones must be a non-empty array');
  }
  for (const m of plan.milestones) {
    if (!m || typeof m.title !== 'string' || !Array.isArray(m.concepts)) {
      throw new HttpError(400, 'each milestone needs a title and a concepts array');
    }
  }
  return plan;
}

export async function createProject(body: unknown): Promise<Project> {
  const plan = validatePlan(body);
  const id = await uniqueSlug(plan.slug || plan.name);
  const dir = projectDir(id);
  await ensureDir(dir);
  await ensureDir(path.join(dir, '.omnilearn', 'cache'));

  const milestones: Milestone[] = plan.milestones.map((m, i) => ({
    id: slugify(m.id || m.title, `milestone-${i + 1}`),
    title: String(m.title),
    status: i === 0 ? 'current' : 'todo',
    concepts: (m.concepts ?? []).map(conceptFromPlan),
    steps: [],
    currentStep: 0,
    entryFile: typeof m.entryFile === 'string' && m.entryFile.trim() ? m.entryFile.trim() : 'main.py',
  }));

  const project: Project = {
    id,
    name: plan.name.trim(),
    goal: typeof plan.goal === 'string' && plan.goal.trim() ? plan.goal.trim() : plan.name.trim(),
    language: 'python',
    createdAt: new Date().toISOString(),
    milestones,
  };

  try {
    for (const file of plan.starterFiles ?? []) {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
      const abs = resolveInProject(dir, file.path);
      await writeTextFile(abs, file.content);
    }
    await saveProject(project);
  } catch (err) {
    // Never leave a half-built folder squatting on the slug.
    await fsp.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return project;
}

// ---------- PATCH merge ----------

const MILESTONE_KEYS = ['title', 'status', 'concepts', 'steps', 'currentStep', 'entryFile'] as const;

function isPartialMilestone(m: unknown): boolean {
  if (!m || typeof m !== 'object') return true;
  const obj = m as Record<string, unknown>;
  return MILESTONE_KEYS.some((k) => obj[k] === undefined);
}

/**
 * Milestones may arrive as a full replacement array or as partials keyed by id.
 * Merge by id whenever the patch is partial and every entry names a known id.
 */
function mergeMilestones(current: Milestone[], patch: unknown[]): Milestone[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  const allKnown = patch.every(
    (m) => m && typeof m === 'object' && byId.has(String((m as Milestone).id)),
  );
  const anyPartial = patch.some(isPartialMilestone);

  if (allKnown && anyPartial) {
    const patched = new Map<string, Partial<Milestone>>();
    for (const p of patch) patched.set(String((p as Milestone).id), p as Partial<Milestone>);
    return current.map((m) => {
      const p = patched.get(m.id);
      return p ? ({ ...m, ...p, id: m.id } as Milestone) : m;
    });
  }
  // Full replacement (also covers reorder / rename / delete / add from the plan editor).
  return patch.map((m, i) => {
    const raw = (m ?? {}) as Partial<Milestone>;
    const existing = raw.id ? byId.get(String(raw.id)) : undefined;
    const base: Milestone = existing ?? {
      id: slugify(String(raw.id ?? raw.title ?? ''), `milestone-${i + 1}`),
      title: String(raw.title ?? ''),
      status: 'todo',
      concepts: [],
      steps: [],
      currentStep: 0,
      entryFile: 'main.py',
    };
    return { ...base, ...raw, id: base.id } as Milestone;
  });
}

export async function patchProject(id: string, patch: Partial<Project>): Promise<Project> {
  const project = await loadProject(id);
  const { id: _ignoredId, milestones, ...rest } = (patch ?? {}) as Partial<Project>;
  const next: Project = { ...project, ...rest, id: project.id };
  if (Array.isArray(milestones)) {
    next.milestones = mergeMilestones(project.milestones, milestones as unknown[]);
  }
  next.language = 'python';
  await saveProject(next);
  return next;
}

// ---------- summaries ----------

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsDir();
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const project = await readJson<Project>(path.join(root, entry.name, 'project.json'));
    if (!project) continue;
    const milestones = Array.isArray(project.milestones) ? project.milestones : [];
    out.push({
      id: entry.name,
      name: project.name ?? entry.name,
      goal: project.goal ?? '',
      language: project.language ?? 'python',
      milestonesDone: milestones.filter((m) => m.status === 'done').length,
      milestonesTotal: milestones.length,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------- files ----------

export async function readProjectFile(id: string, rel: string): Promise<string> {
  const abs = resolveInProject(projectDir(id), rel);
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) throw new HttpError(400, `not a file: ${rel}`);
    return await fsp.readFile(abs, 'utf8');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(404, `no such file: ${rel}`);
  }
}

export async function writeProjectFile(id: string, rel: string, content: string): Promise<void> {
  if (!(await exists(projectDir(id)))) throw new HttpError(404, `no such project: ${id}`);
  const abs = resolveInProject(projectDir(id), rel);
  await writeTextFile(abs, content);
}

export async function projectFiles(id: string): Promise<FileNode[]> {
  const dir = projectDir(id);
  if (!(await exists(dir))) throw new HttpError(404, `no such project: ${id}`);
  return buildFileTree(dir);
}

// ---------- routes ----------

export const projectsRouter: Router = Router();

function queryPath(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'query param "path" is required');
  return value;
}

projectsRouter.get('/projects', async (_req, res, next) => {
  try {
    res.json(await listProjects());
  } catch (err) {
    next(err);
  }
});

projectsRouter.post('/projects', async (req, res, next) => {
  try {
    res.status(201).json(await createProject(req.body));
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/projects/:id', async (req, res, next) => {
  try {
    res.json(await loadProject(req.params.id));
  } catch (err) {
    next(err);
  }
});

projectsRouter.patch('/projects/:id', async (req, res, next) => {
  try {
    res.json(await patchProject(req.params.id, (req.body ?? {}) as Partial<Project>));
  } catch (err) {
    next(err);
  }
});

projectsRouter.delete('/projects/:id', async (req, res, next) => {
  try {
    const dir = projectDir(req.params.id);
    if (!(await exists(dir))) throw new HttpError(404, `no such project: ${req.params.id}`);
    await fsp.rm(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/projects/:id/files', async (req, res, next) => {
  try {
    res.json(await projectFiles(req.params.id));
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/projects/:id/file', async (req, res, next) => {
  try {
    const content = await readProjectFile(req.params.id, queryPath(req.query.path));
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

projectsRouter.put('/projects/:id/file', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { content?: unknown };
    if (typeof body.content !== 'string') throw new HttpError(400, 'body.content must be a string');
    await writeProjectFile(req.params.id, queryPath(req.query.path), body.content);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
