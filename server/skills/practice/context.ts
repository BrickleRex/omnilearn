// Shared loading for the practice routes: the project, its course (kept in sync
// between project.json and research/course.json), its claims, and the model the
// persona panel runs on.

import type { Claim, Course, SkillModule, SkillPhase, SkillProject } from '../../../shared/skills';
import { HttpError } from '../../store';
import { getSettings } from '../../settings';
import { loadClaims, loadCourse, loadSkill } from '../store';

const PHASE_RANK: Record<SkillPhase, number> = {
  framing: 0, mapping: 1, researching: 2, calibrating: 3, learning: 4, practicing: 5, making: 6,
};

/** Phases only move forward — a drill after a run must not drag them back. */
export function raisePhase(project: SkillProject, to: SkillPhase): void {
  if (PHASE_RANK[to] > PHASE_RANK[project.phase]) project.phase = to;
}

export interface PracticeCtx {
  project: SkillProject;
  course: Course;
  claims: Claim[];
}

/** project.json is the fast path; research/course.json is the fallback and the mirror. */
export async function loadPractice(id: string): Promise<PracticeCtx> {
  const project = await loadSkill(id);
  const course = project.course ?? (await loadCourse(id)) ?? undefined;
  if (!course) throw new HttpError(404, `skill ${id} has no course yet — finish research first`);
  project.course = course;
  return { project, course, claims: await loadClaims(id) };
}

export function findModule(course: Course, moduleId: string): SkillModule {
  const module = course.modules.find((m) => m.id === moduleId);
  if (!module) throw new HttpError(404, `no such module: ${moduleId}`);
  return module;
}

export async function panelModel(): Promise<string | undefined> {
  const settings = await getSettings();
  return settings.skillModels?.panel;
}

export function reps(project: SkillProject): SkillProject['reps'] {
  if (!project.reps) project.reps = { drills: 0, runs: 0, ships: 0 };
  return project.reps;
}
