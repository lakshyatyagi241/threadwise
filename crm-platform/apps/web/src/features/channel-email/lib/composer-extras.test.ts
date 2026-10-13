import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXTRAS,
  buildExtras,
  defaultReplySubject,
  latestEmailSubject,
  splitAddresses,
} from './composer-extras';

describe('splitAddresses', () => {
  it('splits on commas, semicolons and spaces and drops repeats', () => {
    expect(splitAddresses('a@x.io, b@x.io;  c@x.io A@x.io')).toEqual([
      'a@x.io',
      'b@x.io',
      'c@x.io',
    ]);
    expect(splitAddresses('  ')).toEqual([]);
  });

  it('takes the address out of <brackets>', () => {
    expect(splitAddresses('<a@x.io>')).toEqual(['a@x.io']);
  });
});

describe('the email extras of a reply', () => {
  it('sends nothing when nothing was added', () => {
    expect(buildExtras(EMPTY_EXTRAS)).toMatchObject({ extras: undefined, problems: {} });
  });

  it('carries cc, bcc and a subject', () => {
    const r = buildExtras({ cc: 'a@x.io, b@x.io', bcc: 'c@x.io', subject: '  Re: Order  ' });
    expect(r.problems).toEqual({});
    expect(r.extras).toEqual({ cc: ['a@x.io', 'b@x.io'], bcc: ['c@x.io'], subject: 'Re: Order' });
  });

  it('leaves the subject out when it is blank, so the default Re: stays', () => {
    expect(buildExtras({ cc: 'a@x.io', bcc: '', subject: ' ' }).extras).toEqual({
      cc: ['a@x.io'],
      bcc: [],
    });
  });

  it('names the addresses that are not addresses and refuses to send', () => {
    const r = buildExtras({ cc: 'a@x.io, nope', bcc: 'also bad', subject: '' });
    expect(r.extras).toBeUndefined();
    expect(r.problems).toEqual({ cc: 'ccInvalid', bcc: 'bccInvalid' });
    expect(r.invalid.cc).toEqual(['nope']);
    expect(r.invalid.bcc).toEqual(['also', 'bad']);
  });

  it('allows 20 addresses and refuses 21', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `u${i}@x.io`).join(',');
    expect(buildExtras({ cc: many(20), bcc: '', subject: '' }).extras?.cc).toHaveLength(20);
    expect(buildExtras({ cc: many(21), bcc: '', subject: '' }).problems.cc).toBe('ccTooMany');
    expect(buildExtras({ cc: '', bcc: many(21), subject: '' }).problems.bcc).toBe('bccTooMany');
  });

  it('refuses a subject over 998 characters', () => {
    expect(buildExtras({ cc: '', bcc: '', subject: 'x'.repeat(999) }).problems.subject).toBe(
      'subjectTooLong',
    );
  });
});

describe('reply subject', () => {
  it('is Re: plus the subject, once', () => {
    expect(defaultReplySubject('Order 4')).toBe('Re: Order 4');
    expect(defaultReplySubject('RE: Order 4')).toBe('RE: Order 4');
    expect(defaultReplySubject('')).toBe('');
    expect(defaultReplySubject(null)).toBe('');
  });

  it('comes from the newest email in the thread, else the conversation title', () => {
    expect(
      latestEmailSubject(
        [{ email: { subject: 'First' } }, { email: null }, { email: { subject: 'Re: First' } }, {}],
        'Title',
      ),
    ).toBe('Re: First');
    expect(latestEmailSubject([{}], 'Title')).toBe('Title');
    expect(latestEmailSubject([], null)).toBe('');
  });
});
