import { createContext, useContext } from 'react';

// App-level navigation. State-based, no router; hash is kept in sync for reloads.
export type View =
  | { name: 'library' }
  | { name: 'milestone'; projectId: string; milestoneId: string } // calibrate + primer flow
  | { name: 'workspace'; projectId: string; milestoneId: string };

export interface Nav {
  view: View;
  go: (v: View) => void;
}

export const NavContext = createContext<Nav>({ view: { name: 'library' }, go: () => {} });
export const useNav = () => useContext(NavContext);
