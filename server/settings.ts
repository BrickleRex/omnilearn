// GET/PUT /api/settings — global Settings persisted at <data>/settings.json.

import { Router } from 'express';
import type { Settings } from '../shared/types';
import { readJson, settingsPath, writeJson } from './store';

export const DEFAULT_SETTINGS: Settings = {
  scheme: 'sunshower',
  guidanceStyle: 'both',
  models: { plan: 'opus', primer: 'opus', hint: 'sonnet', ghost: 'sonnet', watch: 'haiku' },
};

const SCHEMES = new Set(['sunshower', 'blackboard', 'arcade', 'mint']);
const GUIDANCE = new Set(['compass', 'footlight', 'both']);

function coerce(raw: unknown): Settings {
  const p = (raw ?? {}) as Partial<Settings>;
  const models = { ...DEFAULT_SETTINGS.models };
  const rawModels = (p.models ?? {}) as Partial<Settings['models']>;
  for (const key of Object.keys(models) as Array<keyof Settings['models']>) {
    const v = rawModels[key];
    if (typeof v === 'string' && v.trim()) models[key] = v.trim();
  }
  return {
    scheme: SCHEMES.has(String(p.scheme)) ? (p.scheme as Settings['scheme']) : DEFAULT_SETTINGS.scheme,
    guidanceStyle: GUIDANCE.has(String(p.guidanceStyle))
      ? (p.guidanceStyle as Settings['guidanceStyle'])
      : DEFAULT_SETTINGS.guidanceStyle,
    models,
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(settingsPath());
  return coerce(stored ?? {});
}

export async function putSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged = coerce({
    ...current,
    ...patch,
    models: { ...current.models, ...(patch?.models ?? {}) },
  });
  await writeJson(settingsPath(), merged);
  return merged;
}

export const settingsRouter: Router = Router();

settingsRouter.get('/settings', async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/settings', async (req, res, next) => {
  try {
    res.json(await putSettings((req.body ?? {}) as Partial<Settings>));
  } catch (err) {
    next(err);
  }
});
