// Ship: real results come back and get diffed against the prediction. When
// reality lands outside the predicted range, the claims behind that prediction
// are flagged for re-verification (research/flags.json; Refresh reads it later).

import path from 'node:path';
import type { RunReport, Shipment, SkillModule } from '../../../shared/skills';
import { readJson, writeJson } from '../../store';
import { researchDir } from '../store';
import { nextId } from './drafts';

export interface ResearchFlag { claimIds: string[]; shipmentId: string; note: string }

export const flagsFile = (id: string) => path.join(researchDir(id), 'flags.json');

export const nextShipId = (ships: Shipment[]): string => nextId(ships.map((s) => s.id), 'sh');

/** Replies as a percentage of sends; null when nothing was sent. */
export function realityRate(sent: number, replies: number): number | null {
  if (!Number.isFinite(sent) || sent <= 0) return null;
  return (replies / sent) * 100;
}

export function outsideRange(reality: number | null, low: number, high: number): boolean {
  if (reality === null) return false;
  return reality < low || reality > high;
}

/** The claims a wrong prediction implicates: the lever's, plus the rubric's. */
export function flaggedClaimIds(run: RunReport | undefined, module: SkillModule): string[] {
  const ids = new Set<string>();
  for (const m of (run?.biggestLever ?? '').matchAll(/\bc\d+\b/g)) ids.add(m[0]);
  for (const item of module.rubric) for (const id of item.claimIds) ids.add(id);
  return [...ids];
}

export function flagNote(reality: number, low: number, high: number, unit: string): string {
  const r = Math.round(reality * 10) / 10;
  return `Predicted ${low}-${high}${unit}, reality ${r}${unit}. Re-check the claims behind that call.`;
}

export async function appendFlag(id: string, flag: ResearchFlag): Promise<void> {
  const existing = (await readJson<ResearchFlag[]>(flagsFile(id))) ?? [];
  await writeJson(flagsFile(id), [...(Array.isArray(existing) ? existing : []), flag]);
}
