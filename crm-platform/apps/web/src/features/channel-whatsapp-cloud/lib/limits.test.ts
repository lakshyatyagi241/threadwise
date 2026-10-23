import { describe, expect, it } from 'vitest';
import { acceptAttribute, limitHints } from './limits';

describe('limitHints', () => {
  it('gives each kind the channel takes its size in megabytes and the formats the picker takes', () => {
    expect(limitHints(['image', 'document'])).toEqual([
      { kind: 'image', mb: 5, formats: 'JPG, JPEG, PNG' },
      {
        kind: 'document',
        mb: 100,
        formats: 'PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT',
      },
    ]);
  });

  it('is empty when the channel takes no kind', () => {
    expect(limitHints([])).toEqual([]);
  });

  it('lists only formats the file picker actually accepts, so the tooltip cannot promise more', () => {
    const allowed = ['image', 'video', 'audio', 'document'];
    const accept = acceptAttribute(allowed).split(',');
    for (const hint of limitHints(allowed)) {
      for (const format of hint.formats.split(', ')) {
        expect(accept).toContain(`.${format.toLowerCase()}`);
      }
    }
  });
});
