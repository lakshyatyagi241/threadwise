import { describe, expect, it } from 'vitest';
import { updateMarketRequestSchema } from '@crm/contracts';
import { request } from '../test-fixtures';
import { noteTooLong, safeWebsite, triageDraft, triagePatch } from './requests';

describe('triagePatch', () => {
  const r = request({ status: 'open', operatorNote: null, rowVersion: 5 });

  it('is null when nothing changed, so Save stays off', () => {
    expect(triagePatch(r, triageDraft(r))).toBeNull();
    expect(triagePatch(r, { status: 'open', note: '   ' })).toBeNull();
  });

  it('sends rowVersion and the status that changed', () => {
    expect(triagePatch(r, { status: 'planned', note: '' })).toEqual({
      rowVersion: 5,
      status: 'planned',
    });
  });

  it('sends the note, trimmed, and clears it with null', () => {
    expect(triagePatch(r, { status: 'open', note: '  Waiting on their API  ' })).toEqual({
      rowVersion: 5,
      operatorNote: 'Waiting on their API',
    });
    const noted = request({ operatorNote: 'Old note', rowVersion: 6 });
    expect(triagePatch(noted, { status: noted.status, note: '' })).toEqual({
      rowVersion: 6,
      operatorNote: null,
    });
  });

  it('every body it makes passes the contract', () => {
    const body = triagePatch(r, { status: 'shipped', note: 'Live in v2' });
    expect(updateMarketRequestSchema.safeParse(body).success).toBe(true);
  });

  it('knows a note over 500 characters is too long', () => {
    expect(noteTooLong('x'.repeat(500))).toBe(false);
    expect(noteTooLong('x'.repeat(501))).toBe(true);
    expect(
      updateMarketRequestSchema.safeParse({ rowVersion: 1, operatorNote: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('safeWebsite: a request website becomes a link only when it is https without credentials', () => {
  it('accepts an https address', () => {
    expect(safeWebsite('https://www.justdial.com')).toBe('https://www.justdial.com/');
    expect(safeWebsite('  https://example.com/path?x=1 ')).toBe('https://example.com/path?x=1');
  });

  it('refuses everything else', () => {
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'ftp://example.com',
      'https://user:pass@example.com',
      'example.com',
      '',
      null,
    ]) {
      expect(safeWebsite(bad), String(bad)).toBeNull();
    }
  });
});
