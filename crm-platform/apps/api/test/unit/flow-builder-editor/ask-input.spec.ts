import { describe, expect, it } from 'vitest';
import {
  FLB_DATE_FORMATS,
  flbAskInputCheck,
  flbAskInputWrongText,
  flbAskNeedsInputCheck,
  flbCleanAskInputType,
  flbParseDate,
  flbParseDateTime,
  flbParseTime,
  flbAskInputChoices,
  flbToRuntimeData,
} from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';

const ok = (t: Parameters<typeof flbAskInputCheck>[0], v: string, o = {}) =>
  flbAskInputCheck(t, v, o).ok;

describe('checked answers (the console runtime rules, plus phone, alphanumeric and date)', () => {
  it('email: the console pattern; the answer is trimmed', () => {
    expect(ok('email', 'asha@example.com')).toBe(true);
    expect(flbAskInputCheck('email', '  asha@example.com ')).toEqual({
      ok: true,
      value: 'asha@example.com',
    });
    for (const bad of ['asha', 'asha@', 'asha@example', 'a b@example.com', '@example.com', '']) {
      expect(ok('email', bad), bad).toBe(false);
    }
  });

  it('name: letters, marks and spaces only; 2 to 49 characters (the console wants 4+, which refuses "Om")', () => {
    for (const good of ['Om', 'Raj', 'Asha Verma', 'José', 'अनिल', 'Mary Ann'])
      expect(ok('name', good), good).toBe(true);
    for (const bad of ['A', 'Asha1', "O'Brien", 'Anne-Marie', '12', '   ', 'x'.repeat(50)])
      expect(ok('name', bad), bad).toBe(false);
  });

  it('number: an optional minus, digits, an optional decimal part', () => {
    for (const good of ['0', '42', '-7', '3.14', '1000000'])
      expect(ok('number', good), good).toBe(true);
    for (const bad of ['1,000', '+5', '3.', '.5', 'ten', '1 2', '1e5'])
      expect(ok('number', bad), bad).toBe(false);
  });

  it('phone: 7 to 15 digits, an optional leading +; spaces, dashes, dots and brackets are dropped', () => {
    expect(flbAskInputCheck('phone', '+91 98300-83880')).toEqual({
      ok: true,
      value: '+919830083880',
    });
    expect(flbAskInputCheck('phone', '(022) 2345.6789')).toEqual({
      ok: true,
      value: '02223456789',
    });
    for (const bad of ['12345', '1234567890123456', 'call me', '98300 8388a', '++919830083880'])
      expect(ok('phone', bad), bad).toBe(false);
  });

  it('alphanumeric: letters and digits, no spaces or symbols', () => {
    for (const good of ['AB123', 'abc', '2024']) expect(ok('alphanumeric', good), good).toBe(true);
    for (const bad of ['AB 123', 'AB-123', 'ab_1', 'é1'])
      expect(ok('alphanumeric', bad), bad).toBe(false);
  });

  it('free text accepts anything that is not empty (and not absurdly long)', () => {
    expect(ok('text', 'anything at all')).toBe(true);
    expect(ok('text', '   ')).toBe(false);
    expect(ok('text', 'x'.repeat(1001))).toBe(false);
  });

  it('date: a real calendar day in the chosen shape', () => {
    expect(flbParseDate('29-02-2024', 'dd-mm-yyyy')).toBe('2024-02-29');
    expect(flbParseDate('29-02-2023', 'dd-mm-yyyy')).toBeNull();
    expect(flbParseDate('31/04/2025', 'dd/mm/yyyy')).toBeNull();
    expect(flbParseDate('12/31/2025', 'mm/dd/yyyy')).toBe('2025-12-31');
    expect(flbParseDate('2025-07-09', 'yyyy-mm-dd')).toBe('2025-07-09');
    expect(flbParseDate('9.7.2025', 'dd.mm.yyyy')).toBe('2025-07-09');
    expect(flbParseDate('05-06-25', 'dd-mm-yy')).toBe('2025-06-05');
    expect(flbParseDate('05-06-2025', 'dd-mm-yy')).toBeNull();
    expect(flbParseDate('05/06/2025', 'dd-mm-yyyy')).toBeNull();
    expect(flbParseDate('5-6-205', 'dd-mm-yyyy')).toBeNull();
    for (const f of FLB_DATE_FORMATS) expect(flbParseDate('abc', f)).toBeNull();
    expect(ok('date', '15-08-2026', { dateFormat: 'dd-mm-yyyy' })).toBe(true);
    expect(ok('date', '15-08-2026', { dateFormat: 'mm/dd/yyyy' })).toBe(false);
  });

  it('date and time: the date in the chosen shape, then a 24-hour or am/pm time', () => {
    const ok = (raw: string, fmt = 'yyyy-mm-dd') =>
      flbAskInputCheck('datetime', raw, { dateFormat: fmt }).ok;
    expect(ok('2026-08-15 14:30')).toBe(true);
    expect(ok('2026-08-15 2:30 pm')).toBe(true);
    expect(ok('2026-08-15')).toBe(false);
    expect(ok('2026-08-15 25:00')).toBe(false);
    expect(ok('2026-08-15 13:00 pm')).toBe(false);
    expect(ok('15-08-2026 14:30')).toBe(false);
    expect(ok('15-08-2026 09:05', 'dd-mm-yyyy')).toBe(true);
    expect(flbParseDateTime('2026-08-15 2:30 pm', 'yyyy-mm-dd')).toBe('2026-08-15T14:30');
    expect(flbParseDateTime('2026-08-15 12:05 am', 'yyyy-mm-dd')).toBe('2026-08-15T00:05');
    expect(flbAskInputWrongText('datetime', 'yyyy-mm-dd')).toBe(
      'Please enter a valid date and time (YYYY-MM-DD HH:MM)',
    );
  });

  it('time: 24-hour or am/pm, and the picker no longer offers the repeated types', () => {
    expect(flbAskInputCheck('time', '14:30').ok).toBe(true);
    expect(flbAskInputCheck('time', '2:30 pm').ok).toBe(true);
    expect(flbAskInputCheck('time', '25:00').ok).toBe(false);
    expect(flbAskInputCheck('time', '13:00 am').ok).toBe(false);
    expect(flbParseTime('2:05 pm')).toBe('14:05');
    expect(flbAskInputChoices('text')).toEqual([
      'text',
      'name',
      'email',
      'phone',
      'number',
      'date',
      'datetime',
      'time',
    ]);
    // A question that already uses a retired type keeps it, so opening it changes nothing.
    expect(flbAskInputChoices('age')).toContain('age');
    expect(flbAskInputChoices('alphanumeric')).toContain('alphanumeric');
    expect(flbAskInputChoices('date_of_birth')).toContain('date_of_birth');
  });

  it('the ready-made wrong-answer texts: the console ones verbatim, and the date one names the shape', () => {
    expect(flbAskInputWrongText('email')).toBe('Please enter a valid email id');
    expect(flbAskInputWrongText('name')).toBe('Please enter a valid name');
    expect(flbAskInputWrongText('number')).toBe('Please enter a valid number');
    expect(flbAskInputWrongText('date', 'mm/dd/yyyy')).toBe(
      'Please enter a valid date (MM/DD/YYYY)',
    );
  });

  it('an unknown "Validate as" is free text', () => {
    expect(flbCleanAskInputType('zip')).toBe('text');
    expect(flbCleanAskInputType('email')).toBe('email');
  });
});

describe('which Ask becomes the checked question', () => {
  const needs = (data: Record<string, unknown>) =>
    flbAskNeedsInputCheck(
      flbToRuntimeData({ type: 'ask', data: { prompt: 'q', var: 'a', ...data } }),
    );

  it('only one that validates, with no fixed answers and no file upload', () => {
    expect(needs({ validate: 'email' })).toBe(true);
    expect(needs({ validate: 'text' })).toBe(false);
    expect(needs({})).toBe(false);
    expect(needs({ validate: 'email', options: ['yes', 'no'] })).toBe(false);
    expect(needs({ validate: 'number', acceptMedia: true })).toBe(false);
  });

  it('the compiler maps it to AskInput with the settings the executor reads; the plain Ask stays a Question', () => {
    const g = compileGraph({
      flowNodes: [
        { id: 't', type: 'trigger', data: {} },
        {
          id: 'a',
          type: 'ask',
          data: {
            prompt: 'Your email?',
            var: 'email',
            validate: 'email',
            retries: 3,
            wrongReply: 'Nope',
            onFail: 'end',
            saveProperty: true,
            propertyKey: 'email',
          },
        },
        { id: 'b', type: 'ask', data: { prompt: 'Anything?', var: 'x', validate: 'text' } },
      ],
      flowEdges: [],
    });
    const a = g.nodes.find((n) => n.id === 'a')!;
    expect(a.type).toBe('AskInput');
    expect(a.props).toMatchObject({
      question: 'Your email?',
      variable: 'email',
      inputType: 'email',
      maxRetries: 3,
      wrongReplyText: 'Nope',
      onGiveUp: 'end',
      savePropertyKey: 'email',
    });
    expect(g.nodes.find((n) => n.id === 'b')!.type).toBe('Question');
  });
});
