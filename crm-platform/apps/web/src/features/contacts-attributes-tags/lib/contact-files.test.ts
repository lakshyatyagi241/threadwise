import { describe, expect, it } from 'vitest';
import { fileTypeOf, formatBytes } from './contact-files';

describe('formatBytes', () => {
  it('steps through the units by 1024 with a decimal under ten', () => {
    expect(formatBytes(0, 'en')).toMatch(/^0\s?(byte|B)/);
    expect(formatBytes(512, 'en')).toMatch(/^512\s?(byte|B)/);
    expect(formatBytes(1536, 'en')).toMatch(/^1\.5\s?kB$/);
    expect(formatBytes(2_516_582, 'en')).toMatch(/^2\.4\s?MB$/);
    expect(formatBytes(10 * 1024 * 1024, 'en')).toMatch(/^10\s?MB$/);
    expect(formatBytes(3 * 1024 ** 3, 'en')).toMatch(/^3\s?GB$/);
  });

  it('has no unit above terabytes', () => {
    expect(formatBytes(5 * 1024 ** 5, 'en')).toMatch(/TB$/);
  });

  it('is null for an unknown or impossible size', () => {
    expect(formatBytes(null, 'en')).toBeNull();
    expect(formatBytes(undefined, 'en')).toBeNull();
    expect(formatBytes(-1, 'en')).toBeNull();
    expect(formatBytes(Number.NaN, 'en')).toBeNull();
  });

  it('uses the language of the viewer for the number', () => {
    expect(formatBytes(1536, 'de')).toMatch(/^1,5/);
  });
});

describe('fileTypeOf', () => {
  it('prefers the MIME type', () => {
    expect(fileTypeOf('application/pdf', 'a.bin')).toBe('application/pdf');
  });

  it('falls back to the extension in capitals', () => {
    expect(fileTypeOf(null, 'quote.final.pdf')).toBe('PDF');
    expect(fileTypeOf('  ', 'photo.jpeg')).toBe('JPEG');
  });

  it('is null when nothing tells the type', () => {
    expect(fileTypeOf(null, 'README')).toBeNull();
    expect(fileTypeOf(null, '.env')).toBeNull();
    expect(fileTypeOf(null, 'trailing.')).toBeNull();
    expect(fileTypeOf(null, 'odd.ext with space')).toBeNull();
  });
});
