import type {
  Settings, ProjectSummary, Project, ProjectPlan, FileNode, RunResult,
  Calibration, CalibrationSubmit, CalibrationResult, PrimerDoc,
  HintRequest, HintResponse, GhostRequest, GhostResponse, WatchRequest, WatchResponse,
  CompleteRequest, CompleteResponse, ChatMessage, ChatRequest, ChatResponse,
  IdeasRequest, IdeasResponse,
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
  login: (token: string) => req<{ ok: true }>('POST', '/api/auth/login', { token }),
  getSettings: () => req<Settings>('GET', '/api/settings'),
  putSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),

  listProjects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  planProject: (goal: string) => req<ProjectPlan>('POST', '/api/projects/plan', { goal }),
  ideas: (body: IdeasRequest) => req<IdeasResponse>('POST', '/api/projects/ideas', body),
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

  complete: (id: string, body: CompleteRequest) => req<CompleteResponse>('POST', `/api/projects/${id}/complete`, body),
  chatHistory: (id: string, milestoneId: string) =>
    req<ChatMessage[]>('GET', `/api/projects/${id}/chat?milestoneId=${encodeURIComponent(milestoneId)}`),
  chat: (id: string, body: ChatRequest) => req<ChatResponse>('POST', `/api/projects/${id}/chat`, body),

  /**
   * Streaming chat over SSE: `onDelta` fires per text chunk; resolves with the
   * full reply. Callers should fall back to api.chat when this rejects.
   */
  chatStream: async (id: string, body: ChatRequest, onDelta: (text: string) => void): Promise<string> => {
    const res = await fetch(`/api/projects/${id}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
        if (!data) continue;
        let ev: { type: string; text?: string; reply?: string; message?: string };
        try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === 'delta' && ev.text) onDelta(ev.text);
        else if (ev.type === 'done') reply = ev.reply ?? '';
        else if (ev.type === 'error') throw new Error(ev.message || 'chat failed');
      }
    }
    if (reply === null) throw new Error('stream ended without a reply');
    return reply;
  },

  hint: (id: string, body: HintRequest) => req<HintResponse>('POST', `/api/projects/${id}/hint`, body),
  ghost: (id: string, body: GhostRequest) => req<GhostResponse>('POST', `/api/projects/${id}/ghost`, body),
  watch: (id: string, body: WatchRequest) => req<WatchResponse>('POST', `/api/projects/${id}/watch`, body),
};

export function termSocketUrl(projectId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/term?projectId=${encodeURIComponent(projectId)}`;
}
