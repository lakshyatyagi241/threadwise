import { suggestSlug } from './slug';

describe('suggestSlug', () => {
  it('turns a workspace name into the address the API will derive', () => {
    expect(suggestSlug('Acme Inc.')).toBe('acme-inc');
    expect(suggestSlug('  Acme   &   Sons  ')).toBe('acme-sons');
  });

  it('drops accents', () => {
    expect(suggestSlug('Café Münch')).toBe('cafe-munch');
  });

  it('gives nothing when too little is left to make an address', () => {
    expect(suggestSlug('')).toBe('');
    expect(suggestSlug('A')).toBe('');
    expect(suggestSlug('!!!')).toBe('');
  });

  it('cuts at 32 characters without leaving a trailing dash', () => {
    expect(suggestSlug('a'.repeat(40))).toBe('a'.repeat(32));
    expect(suggestSlug(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31));
  });
});
