import { describe, expect, it } from 'vitest';
import { formatPayload, parsePayload } from './payload';

describe('parsePayload', () => {
  it('reads a JSON object', () => {
    expect(parsePayload('{"name":"Asha","lead":{"phone":"+1"}}')).toEqual({
      ok: true,
      payload: { name: 'Asha', lead: { phone: '+1' } },
    });
    expect(parsePayload('  {}  ')).toEqual({ ok: true, payload: {} });
  });

  it('says in plain terms what is wrong', () => {
    expect(parsePayload('')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePayload('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePayload('{name: Asha}')).toEqual({ ok: false, reason: 'invalidJson' });
    expect(parsePayload('{"a":1,}')).toEqual({ ok: false, reason: 'invalidJson' });
    expect(parsePayload('[1,2]')).toEqual({ ok: false, reason: 'notObject' });
    expect(parsePayload('"text"')).toEqual({ ok: false, reason: 'notObject' });
    expect(parsePayload('42')).toEqual({ ok: false, reason: 'notObject' });
    expect(parsePayload('null')).toEqual({ ok: false, reason: 'notObject' });
  });

  it('refuses a payload over 64 KB', () => {
    const big = JSON.stringify({ blob: 'x'.repeat(64 * 1024) });
    expect(parsePayload(big)).toEqual({ ok: false, reason: 'tooLarge' });
    const fine = JSON.stringify({ blob: 'x'.repeat(60 * 1024) });
    expect(parsePayload(fine).ok).toBe(true);
  });
});

describe('formatPayload', () => {
  it('shows the stored payload indented, as text', () => {
    expect(formatPayload({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });
});
