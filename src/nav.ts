import { createContext, useContext } from 'react';

// App-level navigation. State-based, no router; hash is kept in sync for reloads.
export type View =
  | { name: 'library' }
  // calibrate + primer flow; review = re-reading from the workspace: no
  // calibration, no auto-forwarding to the editor even when all is cleared
  | { name: 'milestone'; projectId: string; milestoneId: string; review?: boolean }
  | { name: 'workspace'; projectId: string; milestoneId: string }
  // skills track: one view, several screens; moduleId applies to learn/drills/make
  | { name: 'skill'; skillId: string; screen: SkillScreen; moduleId?: string };

export type SkillScreen = 'map' | 'research' | 'calibrate' | 'learn' | 'drills' | 'make';

export interface Nav {
  view: View;
  go: (v: View) => void;
}

export const NavContext = createContext<Nav>({ view: { name: 'library' }, go: () => {} });
export const useNav = () => useContext(NavContext);
