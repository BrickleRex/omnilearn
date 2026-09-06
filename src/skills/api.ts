import type {
  SkillSummary, SkillProject, CreateSkillRequest, AngleMap, ResearchJob, Claim, SourceRef,
  CalibrationGrade, CalibrationGradeRes, SkillModule, Draft, RunReport, HintReq, HintRes,
  GhostReq, GhostRes, DrillSubmit, DrillAttempt, ShipReq, Shipment,
} from '../../shared/skills';
import type { ChatMessage, ChatRequest, ChatResponse } from '../../shared/types';

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

const B = '/api/skills';
export const skillsApi = {
  list: () => req<SkillSummary[]>('GET', B),
  create: (body: CreateSkillRequest) => req<SkillProject>('POST', B, body),
  get: (id: string) => req<SkillProject>('GET', `${B}/${id}`),
  remove: (id: string) => req<{ ok: true }>('DELETE', `${B}/${id}`),
  putMap: (id: string, map: AngleMap) => req<SkillProject>('PUT', `${B}/${id}/map`, map),
  startResearch: (id: string) => req<ResearchJob>('POST', `${B}/${id}/research`),
  research: (id: string) => req<ResearchJob>('GET', `${B}/${id}/research`),
  researchStreamUrl: (id: string) => `${B}/${id}/research/stream`,
  claims: (id: string) => req<Claim[]>('GET', `${B}/${id}/claims`),
  sources: (id: string) => req<SourceRef[]>('GET', `${B}/${id}/sources`),
  addSource: (id: string, body: { url?: string; title: string; text: string }) => req<SourceRef>('POST', `${B}/${id}/sources`, body),
  gradeExisting: (id: string, body: CalibrationGrade) => req<CalibrationGradeRes>('POST', `${B}/${id}/calibration/grade`, body),
  patchModule: (id: string, mid: string, patch: Partial<SkillModule>) => req<SkillProject>('PATCH', `${B}/${id}/modules/${mid}`, patch),
  drafts: (id: string) => req<Draft[]>('GET', `${B}/${id}/drafts`),
  createDraft: (id: string, body: { moduleId: string; title: string; body?: string }) => req<Draft>('POST', `${B}/${id}/drafts`, body),
  saveDraft: (id: string, did: string, body: string) => req<Draft>('PUT', `${B}/${id}/drafts/${did}`, { body }),
  run: (id: string, draftId: string, version: number) => req<RunReport>('POST', `${B}/${id}/run`, { draftId, version }),
  hint: (id: string, body: HintReq) => req<HintRes>('POST', `${B}/${id}/hint`, body),
  ghost: (id: string, body: GhostReq) => req<GhostRes>('POST', `${B}/${id}/ghost`, body),
  submitDrill: (id: string, body: DrillSubmit) => req<DrillAttempt>('POST', `${B}/${id}/drills/submit`, body),
  attempts: (id: string) => req<DrillAttempt[]>('GET', `${B}/${id}/drills/attempts`),
  ship: (id: string, body: ShipReq) => req<Shipment>('POST', `${B}/${id}/ship`, body),
  ships: (id: string) => req<Shipment[]>('GET', `${B}/${id}/ships`),
  refresh: (id: string) => req<ResearchJob>('POST', `${B}/${id}/refresh`),
  chatHistory: (id: string, moduleId: string) => req<ChatMessage[]>('GET', `${B}/${id}/chat?milestoneId=${encodeURIComponent(moduleId)}`),
  chat: (id: string, body: ChatRequest) => req<ChatResponse>('POST', `${B}/${id}/chat`, body),
  chatStreamUrl: (id: string) => `${B}/${id}/chat/stream`,
};
