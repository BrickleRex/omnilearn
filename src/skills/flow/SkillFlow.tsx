// PLACEHOLDER — owned by the skills-flow agent. Replace entirely (keep the export + props).
import type { Settings } from '../../../shared/types';
import type { SkillScreen } from '../../nav';
export default function SkillFlow(_p: { skillId: string; screen: Exclude<SkillScreen, 'make'>; moduleId?: string; settings: Settings }) {
  return <div data-testid="skill-flow">Skill flow placeholder</div>;
}
