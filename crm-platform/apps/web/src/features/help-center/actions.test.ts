import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisibleHelp } from './resolve';
import type { HelpDoc } from './types';

const loader = vi.hoisted(() => ({ getVisibleHelp: vi.fn() }));
vi.mock('./server', () => loader);
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));

import { getHelpTip } from './actions';

const doc: HelpDoc = {
  id: 'contacts',
  area: 'audience',
  order: 1,
  documents: [],
  gates: {},
  keywords: [],
  routes: [],
  features: [],
  audience: 'workspace',
  domain: 'd',
  text: {
    en: {
      title: 'Contacts',
      summary: 'Your people.',
      blocks: [
        { t: 'p', inline: [{ t: 'text', v: 'Intro.' }] },
        { t: 'h', level: 2, id: 'duplicates', text: 'Duplicates' },
        { t: 'p', inline: [{ t: 'text', v: 'We match on phone number.' }] },
      ],
    },
  },
};
const view = (docs: HelpDoc[]): VisibleHelp => ({ docs, entries: [] });

describe('getHelpTip', () => {
  beforeEach(() => {
    loader.getVisibleHelp.mockReset();
    loader.getVisibleHelp.mockResolvedValue(view([doc]));
  });

  it('returns the first paragraph under the heading of a visible guide', async () => {
    expect(await getHelpTip('contacts', 'duplicates')).toBe('We match on phone number.');
  });

  it('returns null for a guide the person cannot see (not in the visible set)', async () => {
    loader.getVisibleHelp.mockResolvedValue(view([]));
    expect(await getHelpTip('contacts', 'duplicates')).toBeNull();
  });

  it('returns null for an unknown heading', async () => {
    expect(await getHelpTip('contacts', 'gone')).toBeNull();
  });

  it('returns null when signed out', async () => {
    loader.getVisibleHelp.mockResolvedValue(null);
    expect(await getHelpTip('contacts', 'duplicates')).toBeNull();
  });

  it('rejects malformed input before looking anything up', async () => {
    for (const [d, a] of [
      ['contacts', '../x'],
      ['contacts', ''],
      ['contacts', 'a'.repeat(81)],
      ['Bad_Doc', 'duplicates'],
      ['', 'duplicates'],
    ] as const) {
      expect(await getHelpTip(d, a)).toBeNull();
    }
    expect(loader.getVisibleHelp).not.toHaveBeenCalled();
  });
});
