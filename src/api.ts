import type {
  Settings, ProjectSummary, Project, ProjectPlan, FileNode, RunResult,
  Calibration, CalibrationSubmit, CalibrationResult, PrimerDoc,
  HintRequest, HintResponse, GhostRequest, GhostResponse, WatchRequest, WatchResponse,
} from '../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = ((await res.json()) as { error: string }).error; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => req<Settings>('GET', '/api/settings'),
  putSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),

  listProjects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  planProject: (goal: string) => req<ProjectPlan>('POST', '/api/projects/plan', { goal }),
  createProject: (plan: ProjectPlan) => req<Project>('POST', '/api/projects', plan),
  getProject: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  patchProject: (id: string, patch: Partial<Project>) => req<Project>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),

  listFiles: (id: string) => req<FileNode[]>('GET', `/api/projects/${id}/files`),
  readFile: (id: string, path: string) =>
    req<{ content: string }>('GET', `/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  writeFile: (id: string, path: string, content: string) =>
    req<{ ok: true }>('PUT', `/api/projects/${id}/file?path=${encodeURIComponent(path)}`, { content }),
  run: (id: string, path: string) => req<RunResult>('POST', `/api/projects/${id}/run`, { path }),

  calibration: (id: string, milestoneId: string) =>
    req<Calibration>('POST', `/api/projects/${id}/calibration`, { milestoneId }),
  submitCalibration: (id: string, body: CalibrationSubmit) =>
    req<CalibrationResult>('POST', `/api/projects/${id}/calibration/submit`, body),
  primer: (id: string, milestoneId: string) =>
    req<PrimerDoc>('POST', `/api/projects/${id}/primer`, { milestoneId }),

  hint: (id: string, body: HintRequest) => req<HintResponse>('POST', `/api/projects/${id}/hint`, body),
  ghost: (id: string, body: GhostRequest) => req<GhostResponse>('POST', `/api/projects/${id}/ghost`, body),
  watch: (id: string, body: WatchRequest) => req<WatchResponse>('POST', `/api/projects/${id}/watch`, body),
};

export function termSocketUrl(projectId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/term?projectId=${encodeURIComponent(projectId)}`;
}
