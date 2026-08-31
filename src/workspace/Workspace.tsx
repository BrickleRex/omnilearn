// PLACEHOLDER — owned by the workspace agent. Replace entirely.
import type { Settings } from '../../shared/types';

export default function Workspace(_props: {
  projectId: string; milestoneId: string;
  settings: Settings; onSettings: (s: Settings) => void;
}) {
  return <div data-testid="workspace">Workspace placeholder</div>;
}
