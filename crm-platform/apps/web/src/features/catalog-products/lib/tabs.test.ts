import { describe, expect, it } from 'vitest';
import { CATALOG_TABS, activeTab } from './tabs';

describe('catalog tabs', () => {
  it('are Setup, Send, Collections, Activity in that order', () => {
    expect(CATALOG_TABS.map((t) => t.id)).toEqual(['setup', 'send', 'collections', 'activity']);
    expect(CATALOG_TABS.map((t) => t.href)).toEqual([
      '/catalog',
      '/catalog/send',
      '/catalog/collections',
      '/catalog/activity',
    ]);
  });
  it('finds the active tab from the path, trailing slash or not', () => {
    expect(activeTab('/catalog')).toBe('setup');
    expect(activeTab('/catalog/')).toBe('setup');
    expect(activeTab('/catalog/send')).toBe('send');
    expect(activeTab('/catalog/collections/')).toBe('collections');
    expect(activeTab('/catalog/activity')).toBe('activity');
    expect(activeTab('/catalog/unknown')).toBe('setup');
  });
});
