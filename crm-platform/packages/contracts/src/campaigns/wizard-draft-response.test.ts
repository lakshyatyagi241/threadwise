import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A saved draft as the API returns it on create: the browser parses this with `wizardDraftResponseSchema`. */
const savedDraft = {
  id: '6f1c2b1e-9a3d-4c5b-8e7f-0a1b2c3d4e5f',
  status: 'draft',
  draft: { name: 'New camaign-26', senderKey: 'waba:0b9e1f4a-2c3d-4e5f-8a6b-7c8d9e0f1a2b' },
  rowVersion: 2,
  createdAt: '2026-10-26T09:05:40.896Z',
  updatedAt: '2026-10-26T09:05:40.896Z',
};

describe('wizard draft response', () => {
  // Each entry point loads the contracts in a different order. A cycle between campaign.ts and broadcast-wizard.ts only broke the
  // status enum when campaign.ts was loaded first, so every entry point is checked on a fresh module graph.
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(['./campaign', './broadcast-wizard', '../index'])(
    'parses a saved draft when %s is loaded first',
    async (entry) => {
      await import(entry);
      const { wizardDraftResponseSchema } = await import('./broadcast-wizard');
      expect(wizardDraftResponseSchema.safeParse(savedDraft).success).toBe(true);
    },
  );
});
