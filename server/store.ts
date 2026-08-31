// Filesystem layout, JSON helpers and path safety for Omnilearn.
//
//   <data>/projects/<slug>/project.json
//   <data>/projects/<slug>/.omnilearn/cache/<milestoneId>.{calibration,primer}.json
//   <data>/settings.json
//
// Every path that comes from a client is resolved *inside* the owning project
// directory; anything that escapes is a 400.

import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FileNode } from '../shared/types';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

// ---------- locations (read env lazily so tests can point elsewhere) ----------

export function dataDir(): string {
  return path.resolve(process.cwd(), process.env.OMNILEARN_DATA ?? 'data');
}

export function projectsDir(): string {
  return path.join(dataDir(), 'projects');
}

export function settingsPath(): string {
  return path.join(dataDir(), 'settings.json');
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Validate a project id (== folder name) and return its absolute directory. */
export function projectDir(id: string): string {
  const raw = String(id ?? '');
  if (!ID_RE.test(raw) || raw.includes('..') || raw.length > 120) {
    throw new HttpError(400, `invalid project id: ${raw}`);
  }
  return path.join(projectsDir(), raw);
}

export function cacheDir(id: string): string {
  return path.join(projectDir(id), '.omnilearn', 'cache');
}

// ---------- path safety ----------

/**
 * Resolve `rel` inside `root`. Throws 400 for absolute paths, `..` escapes,
 * NUL bytes, or anything else that lands outside the project folder.
 */
export function resolveInProject(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new HttpError(400, 'path is required');
  }
  if (rel.includes('\0')) throw new HttpError(400, 'invalid path');
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new HttpError(400, `path escapes the project: ${rel}`);
  }
  return target;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function slugify(input: string, fallback = 'project'): string {
  const s = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

// ---------- fs helpers ----------

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Read JSON, deleting the file if it is unreadable/corrupt (cache hygiene). */
export async function readJsonOrDelete<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    await fsp.rm(file, { force: true });
    return null;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function writeTextFile(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, content, 'utf8');
}

// ---------- file tree ----------

const SKIP_DIRS = new Set(['node_modules', '__pycache__']);

/** Recursive project-relative tree. Skips dotted names and node_modules. */
export async function buildFileTree(root: string, rel = '', depth = 0): Promise<FileNode[]> {
  if (depth > 8) return [];
  let entries;
  try {
    entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    if (SKIP_DIRS.has(name)) continue;
    if (rel === '' && name === 'project.json') continue; // app metadata, not workspace material
    const childRel = rel ? `${rel}/${name}` : name;
    if (entry.isDirectory()) {
      nodes.push({
        name,
        path: childRel,
        type: 'dir',
        children: await buildFileTree(root, childRel, depth + 1),
      });
    } else if (entry.isFile()) {
      nodes.push({ name, path: childRel, type: 'file' });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
