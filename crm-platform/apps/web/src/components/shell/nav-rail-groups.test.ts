import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from '@/features/_registry/types';
import { USER_MENU_GROUPS } from './nav-model';
import { GROUP_ICON } from './nav-rail';

describe('the slim rail', () => {
  it('has an icon for every menu group it draws', () => {
    // Help lives in the user menu and Settings is the pinned entry at the bottom; neither is a group icon.
    const drawn = NAV_GROUPS.filter((g) => !USER_MENU_GROUPS.includes(g) && g !== 'settings');
    for (const group of drawn) expect(GROUP_ICON[group], group).toBeTruthy();
  });
});
