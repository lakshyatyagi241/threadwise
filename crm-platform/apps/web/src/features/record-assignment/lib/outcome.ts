import type { AssignmentTraceEntry, TestAssignmentResponse } from '@crm/contracts';

export type TestOutcome = TestAssignmentResponse['outcome'];

export type Tone = 'success' | 'info' | 'warning';

/** How the test box colours its answer. */
export const outcomeTone = (o: TestOutcome): Tone =>
  o === 'would_assign' ? 'success' : o === 'has_owner' || o === 'disabled' ? 'info' : 'warning';

export type TraceStatus = 'winner' | 'matched' | 'not_matched' | 'nobody' | 'broken';

/**
 * What happened to each rule that was tried. The engine stops at the first rule that matches and finds someone, so that entry is the
 * winner (when the run assigned); a rule that matched but found nobody is shown as such, and a broken condition is called out.
 */
export function traceStatuses(
  trace: readonly AssignmentTraceEntry[],
  assigned: boolean,
): TraceStatus[] {
  let won = false;
  return trace.map((e) => {
    if (e.broken) return 'broken';
    if (e.matched && e.nobody) return 'nobody';
    if (e.matched) {
      if (assigned && !won) {
        won = true;
        return 'winner';
      }
      return 'matched';
    }
    return 'not_matched';
  });
}

export const runTone = (outcome: string): Tone =>
  outcome === 'assigned' ? 'success' : outcome === 'reassigned' ? 'info' : 'warning';
