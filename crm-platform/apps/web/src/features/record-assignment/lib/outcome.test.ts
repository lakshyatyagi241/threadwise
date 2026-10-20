import { describe, expect, it } from 'vitest';
import type { AssignmentTraceEntry } from '@crm/contracts';
import { outcomeTone, runTone, traceStatuses } from './outcome';

const U = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const e = (over: Partial<AssignmentTraceEntry>): AssignmentTraceEntry => ({
  ruleId: U,
  name: 'R',
  matched: false,
  nobody: false,
  broken: false,
  excluded: [],
  ...over,
});

describe('traceStatuses', () => {
  const trace = [
    e({ broken: true }),
    e({ matched: false }),
    e({ matched: true, nobody: true }),
    e({ matched: true }),
    e({ matched: true }),
  ];
  it('calls the first rule that matched and found somebody the winner when the record was assigned', () => {
    expect(traceStatuses(trace, true)).toEqual([
      'broken',
      'not_matched',
      'nobody',
      'winner',
      'matched',
    ]);
  });
  it('has no winner when nothing was assigned', () => {
    expect(traceStatuses(trace, false)).not.toContain('winner');
  });
});

describe('tones', () => {
  it('colours the test outcomes', () => {
    expect(outcomeTone('would_assign')).toBe('success');
    expect(outcomeTone('has_owner')).toBe('info');
    expect(outcomeTone('disabled')).toBe('info');
    expect(outcomeTone('nobody_available')).toBe('warning');
    expect(outcomeTone('not_found')).toBe('warning');
  });
  it('colours the run outcomes', () => {
    expect(runTone('assigned')).toBe('success');
    expect(runTone('reassigned')).toBe('info');
    expect(runTone('skipped')).toBe('warning');
  });
});
