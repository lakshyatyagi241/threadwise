import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CALLING_CHECK_CODES, CALLING_CHECK_KEYS, CALLING_META_REASONS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';

const en = JSON.parse(
  readFileSync(
    join(resolve(__dirname, '../../..'), 'messages', 'en', 'calling-voice.readiness.json'),
    'utf8',
  ),
) as { 'calling-voice': { readiness: Record<string, Record<string, unknown>> } };
const r = en['calling-voice'].readiness;

/** The server sends codes; the web must have words for every one of them (a code with none would print a key path). */
describe('calling readiness messages', () => {
  it('has a label for every row of the checklist', () => {
    for (const k of CALLING_CHECK_KEYS) expect(r.checks![k], k).toBeTypeOf('string');
  });

  it('has a finding for every code, and an instruction for every code that is not a pass', () => {
    const codes = r.codes as Record<string, { detail?: string; fix?: string }>;
    for (const c of CALLING_CHECK_CODES) {
      expect(codes[c]?.detail, `${c}.detail`).toBeTypeOf('string');
      const passes =
        /(_ok|_added|_on)$|^(connected|cloud_api_only|limit_test_number|recording_off|recording_configured)$/.test(
          c,
        );
      if (!passes) expect(codes[c]?.fix, `${c}.fix`).toBeTypeOf('string');
    }
    expect(Object.keys(codes).sort()).toEqual([...CALLING_CHECK_CODES].sort());
  });

  it('has words for every reason Meta can be refused for, except the one with no name', () => {
    for (const reason of CALLING_META_REASONS.filter((x) => x !== 'unknown')) {
      expect(r.reasons![reason], reason).toBeTypeOf('string');
    }
  });

  it('has words for every status of a number', () => {
    for (const s of ['never_checked', 'blocked', 'ready_to_enable', 'attention', 'ready']) {
      expect(r.status![s], s).toBeTypeOf('string');
      expect(r.statusHint![s], s).toBeTypeOf('string');
    }
  });
});
