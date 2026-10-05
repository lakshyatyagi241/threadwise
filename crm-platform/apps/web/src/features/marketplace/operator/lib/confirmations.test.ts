import { describe, expect, it } from 'vitest';
import {
  killMarketAppSchema,
  rejectMarketVersionSchema,
  approveMarketVersionSchema,
  updateMarketRequestSchema,
} from '@crm/contracts';
import {
  APPROVE_NOTE_MAX,
  KILL_REASON_MAX,
  KILL_REASON_MIN,
  REJECT_NOTE_MAX,
  REJECT_NOTE_MIN,
  REQUEST_NOTE_MAX,
  approveCheck,
  killCheck,
  rejectCheck,
  textRule,
} from './confirmations';

describe('the limits equal the contract', () => {
  it('kill reason 5 to 300', () => {
    expect(killMarketAppSchema.safeParse({ reason: 'x'.repeat(KILL_REASON_MIN - 1) }).success).toBe(
      false,
    );
    expect(killMarketAppSchema.safeParse({ reason: 'x'.repeat(KILL_REASON_MIN) }).success).toBe(
      true,
    );
    expect(killMarketAppSchema.safeParse({ reason: 'x'.repeat(KILL_REASON_MAX) }).success).toBe(
      true,
    );
    expect(killMarketAppSchema.safeParse({ reason: 'x'.repeat(KILL_REASON_MAX + 1) }).success).toBe(
      false,
    );
  });

  it('reject note 5 to 500, approve note up to 500, request note up to 500', () => {
    expect(
      rejectMarketVersionSchema.safeParse({ note: 'x'.repeat(REJECT_NOTE_MIN - 1) }).success,
    ).toBe(false);
    expect(rejectMarketVersionSchema.safeParse({ note: 'x'.repeat(REJECT_NOTE_MIN) }).success).toBe(
      true,
    );
    expect(
      rejectMarketVersionSchema.safeParse({ note: 'x'.repeat(REJECT_NOTE_MAX + 1) }).success,
    ).toBe(false);
    expect(
      approveMarketVersionSchema.safeParse({ note: 'x'.repeat(APPROVE_NOTE_MAX) }).success,
    ).toBe(true);
    expect(
      approveMarketVersionSchema.safeParse({ note: 'x'.repeat(APPROVE_NOTE_MAX + 1) }).success,
    ).toBe(false);
    expect(
      updateMarketRequestSchema.safeParse({
        rowVersion: 1,
        operatorNote: 'x'.repeat(REQUEST_NOTE_MAX + 1),
      }).success,
    ).toBe(false);
  });
});

describe('textRule', () => {
  it('counts the trimmed text, as the API does', () => {
    expect(textRule('   abcd   ', 5, 10)).toEqual({
      length: 4,
      tooShort: true,
      tooLong: false,
      ok: false,
    });
    expect(textRule('abcde', 5, 10).ok).toBe(true);
    expect(textRule('x'.repeat(11), 5, 10)).toMatchObject({ tooLong: true, ok: false });
  });
});

describe('killCheck: the red button needs a reason and the typed slug', () => {
  const slug = 'acme-leads';
  const reason = 'The portal leaked contact data';

  it('is off with nothing typed', () => {
    expect(killCheck(slug, '', '').canKill).toBe(false);
  });

  it('is off with a reason but no slug, or a slug but no reason', () => {
    expect(killCheck(slug, '', reason).canKill).toBe(false);
    expect(killCheck(slug, slug, '').canKill).toBe(false);
  });

  it('is off while the reason is under five characters, even with the slug', () => {
    expect(killCheck(slug, slug, 'oops').canKill).toBe(false);
    expect(killCheck(slug, slug, '  abcd  ').canKill).toBe(false);
  });

  it('is off when the slug is nearly right (case, prefix, another listing)', () => {
    for (const typed of ['Acme-Leads', 'acme-lead', 'acme-leads-2', 'acme leads']) {
      expect(killCheck(slug, typed, reason).slugMatches, typed).toBe(false);
      expect(killCheck(slug, typed, reason).canKill, typed).toBe(false);
    }
  });

  it('is on with the exact slug (spaces around it are forgiven) and a reason of 5 to 300 characters', () => {
    expect(killCheck(slug, slug, reason)).toMatchObject({ slugMatches: true, canKill: true });
    expect(killCheck(slug, `  ${slug} `, reason).canKill).toBe(true);
    expect(killCheck(slug, slug, 'x'.repeat(KILL_REASON_MIN)).canKill).toBe(true);
    expect(killCheck(slug, slug, 'x'.repeat(KILL_REASON_MAX)).canKill).toBe(true);
  });

  it('is off again when the reason runs past 300 characters', () => {
    const c = killCheck(slug, slug, 'x'.repeat(KILL_REASON_MAX + 1));
    expect(c.reason.tooLong).toBe(true);
    expect(c.canKill).toBe(false);
  });

  it('never matches an empty slug', () => {
    expect(killCheck('', '', reason).canKill).toBe(false);
  });
});

describe('rejectCheck and approveCheck', () => {
  it('a rejection needs a reason of at least five characters', () => {
    expect(rejectCheck('').ok).toBe(false);
    expect(rejectCheck('nope').ok).toBe(false);
    expect(rejectCheck('Not clear').ok).toBe(true);
    expect(rejectCheck('x'.repeat(REJECT_NOTE_MAX + 1)).ok).toBe(false);
  });

  it('an approval note is optional but not unlimited', () => {
    expect(approveCheck('').ok).toBe(true);
    expect(approveCheck('Looks good').ok).toBe(true);
    expect(approveCheck('x'.repeat(APPROVE_NOTE_MAX + 1)).ok).toBe(false);
  });
});
