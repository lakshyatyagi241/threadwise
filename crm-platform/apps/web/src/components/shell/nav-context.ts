'use client';

import { createContext, useContext } from 'react';

/**
 * True while the navigation is the slim icon rail. Content a domain puts in the menu's footer slot (the workspace
 * card) reads it to shrink to just its avatar; everywhere else it is false.
 */
export const NavCollapsedContext = createContext(false);

export function useNavCollapsed(): boolean {
  return useContext(NavCollapsedContext);
}
