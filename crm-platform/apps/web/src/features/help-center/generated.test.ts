import { describe, expect, it } from 'vitest';
import { HELP_DOCS } from '@/features/_registry/help.generated';

describe('generated help registry', () => {
  it('is an array of docs that each have English text', () => {
    expect(Array.isArray(HELP_DOCS)).toBe(true);
    for (const doc of HELP_DOCS) {
      expect(doc.text.en?.title, doc.id).toBeTruthy();
      expect(doc.text.en?.blocks.length, doc.id).toBeGreaterThan(0);
    }
  });

  it('has the two guides of this domain, always visible (no gates of their own)', () => {
    const documents: Record<string, string[]> = {
      'getting-started': [],
      // The Help entry in the menu is always available, so documenting it never hides the guide.
      'using-help': ['nav:help-center'],
    };
    for (const [id, expected] of Object.entries(documents)) {
      const doc = HELP_DOCS.find((d) => d.id === id);
      expect(doc, id).toBeDefined();
      expect(doc!.area).toBe('getting-started');
      expect(doc!.documents).toEqual(expected);
      expect(doc!.gates).toEqual({});
    }
  });

  it('has unique ids', () => {
    const ids = HELP_DOCS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
