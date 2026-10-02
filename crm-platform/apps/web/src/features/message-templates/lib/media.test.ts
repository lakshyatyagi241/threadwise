import { describe, expect, it } from 'vitest';
import { MEDIA_MAX_BYTES, mediaProblem, megabytes } from './media';

describe('header media checks', () => {
  it('accepts a right-sized file of the right type', () => {
    expect(mediaProblem('image', { type: 'image/png', size: 1000 })).toBeNull();
    expect(mediaProblem('document', { type: 'application/pdf', size: 1000 })).toBeNull();
    expect(mediaProblem('video', { type: 'video/mp4', size: 1000 })).toBeNull();
  });

  it('rejects a wrong type, an empty file and a file over the cap', () => {
    expect(mediaProblem('image', { type: 'application/pdf', size: 1000 })).toBe('wrongType');
    expect(mediaProblem('image', { type: 'image/png', size: 0 })).toBe('empty');
    expect(mediaProblem('image', { type: 'image/png', size: MEDIA_MAX_BYTES.image + 1 })).toBe(
      'tooBig',
    );
    expect(mediaProblem('video', { type: 'video/mp4', size: MEDIA_MAX_BYTES.video + 1 })).toBe(
      'tooBig',
    );
  });

  it('formats sizes in megabytes', () => {
    expect(megabytes(5 * 1024 * 1024)).toBe('5.0');
  });
});
