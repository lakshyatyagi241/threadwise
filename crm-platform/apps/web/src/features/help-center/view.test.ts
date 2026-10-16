import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN } from '@/features/_registry/resolve';
import type { Capabilities } from '@/features/_registry/types';
import { helpFor } from './view';
import type { HelpDoc } from './types';

const doc = (id: string, over: Partial<HelpDoc> = {}): HelpDoc => ({
  id,
  area: 'getting-started',
  order: 1,
  documents: [],
  gates: {},
  keywords: [],
  routes: [],
  features: [],
  audience: 'workspace',
  domain: 'd',
  text: {
    en: { title: `Title ${id}`, summary: `About ${id}`, blocks: [] },
    ar: { title: `عنوان ${id}`, summary: 'ملخص', blocks: [] },
  },
  ...over,
});
const caps = (features: string[]): Capabilities => ({
  ...CAPABILITIES_UNKNOWN,
  planFeatures: new Set(features),
});

describe('helpFor', () => {
  it('resolves the real menu and tiles: a doc for a declared screen is visible', () => {
    // `settings` is declared by features/settings-hub/nav.ts, so it is in the generated registry.
    const view = helpFor(CAPABILITIES_UNKNOWN, 'en', [
      doc('settings-doc', { documents: ['nav:settings'] }),
    ]);
    expect(view.docs.map((d) => d.id)).toEqual(['settings-doc']);
    expect(view.entries[0]).toMatchObject({ id: 'settings-doc', routes: ['/settings'] });
  });

  it('hides a doc for a screen that no domain declares', () => {
    const view = helpFor(CAPABILITIES_UNKNOWN, 'en', [
      doc('ghost', { documents: ['nav:no-such-screen'] }),
    ]);
    expect(view.docs).toEqual([]);
    expect(view.entries).toEqual([]);
  });

  it('removes a doc gated on a plan feature the workspace lacks, keeps it when the plan has it', () => {
    const gated = doc('gated', { gates: { planFeature: 'automation' } });
    expect(helpFor(caps([]), 'en', [gated]).docs).toEqual([]);
    expect(helpFor(caps(['automation']), 'en', [gated]).docs.map((d) => d.id)).toEqual(['gated']);
  });

  it("builds the index in the person's language", () => {
    const view = helpFor(CAPABILITIES_UNKNOWN, 'ar', [doc('a')]);
    expect(view.entries[0]).toMatchObject({ title: 'عنوان a', fallback: false });
  });
});
