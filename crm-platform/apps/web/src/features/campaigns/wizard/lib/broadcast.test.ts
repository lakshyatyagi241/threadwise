import { describe, expect, it } from 'vitest';
import type { WizardBroadcastDetail } from '@crm/contracts';
import { deletable } from './broadcast';

const run = (status: string, sent: number) =>
  ({ id: 'r', occurrence: 1, status, counts: { recipients: 5, sent, failed: 0 } }) as never;
const b = (
  kind: 'campaign' | 'series',
  status: string,
  runs: Array<ReturnType<typeof run>> = [],
): Pick<WizardBroadcastDetail, 'kind' | 'status' | 'runList'> => ({ kind, status, runList: runs });

describe('when Delete is offered', () => {
  it('a one-off broadcast follows the campaign rule: waiting for its time, or failed outright', () => {
    expect(deletable(b('campaign', 'scheduled'))).toBe(true);
    expect(deletable(b('campaign', 'failed'))).toBe(true);
    for (const s of ['running', 'paused', 'completed', 'cancelled', 'draft'])
      expect(deletable(b('campaign', s))).toBe(false);
  });

  it('a recurring series can go while none of its runs has sent a message or is going, whatever its own status', () => {
    expect(deletable(b('series', 'active'))).toBe(true);
    expect(deletable(b('series', 'cancelled', [run('cancelled', 0)]))).toBe(true);
    expect(deletable(b('series', 'active', [run('scheduled', 0), run('scheduled', 0)]))).toBe(true);
  });

  it('a series keeps its history once a run has sent, and is never deleted under a run that is going', () => {
    expect(deletable(b('series', 'cancelled', [run('completed', 3)]))).toBe(false);
    expect(deletable(b('series', 'active', [run('scheduled', 0), run('completed', 1)]))).toBe(
      false,
    );
    expect(deletable(b('series', 'active', [run('running', 0)]))).toBe(false);
  });
});
