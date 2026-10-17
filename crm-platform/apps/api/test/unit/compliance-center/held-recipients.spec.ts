import { describe, expect, it, vi } from 'vitest';
import { ALLOW, type SendWindowDecision } from '@crm/contracts';
import {
  WAKE_MARGIN_MS,
  heldOf,
  scheduleWake,
  splitByQuietHours,
  wakeDelayMs,
  wakeJobId,
} from '../../../src/modules/compliance-center/held-recipients';
import type { SendWindowService } from '../../../src/modules/compliance-center/send-window.service';

const hold = (until: string): SendWindowDecision => ({
  decision: 'hold',
  reason: 'quiet_hours',
  until,
  zone: 'Asia/Kolkata',
  zoneSource: 'contact_field',
});

/** A SendWindowService that holds the contact ids it is told to, and answers `anonymous` for a recipient without a contact. */
function fakeWindow(held: Record<number, string>, anonymous: SendWindowDecision = ALLOW) {
  const checkMany = vi.fn((_org: number, _kind: string, ids: readonly number[]) =>
    Promise.resolve({
      decisions: new Map(ids.map((id) => [id, held[id] ? hold(held[id]!) : ALLOW])),
    }),
  );
  const check = vi.fn(() => Promise.resolve(anonymous));
  return { service: { checkMany, check } as unknown as SendWindowService, checkMany, check };
}

describe('splitByQuietHours', () => {
  it('splits a slice into who goes and who waits, keeping each hold', async () => {
    const w = fakeWindow({ 2: '2026-10-16T03:30:00.000Z' });
    const rows = [
      { id: 1, contactId: 1 },
      { id: 2, contactId: 2 },
      { id: 3, contactId: 3 },
    ];
    const out = await splitByQuietHours(w.service, 7, rows);
    expect(out.go.map((r) => r.id)).toEqual([1, 3]);
    expect(out.held.map((h) => h.row.id)).toEqual([2]);
    expect(out.held[0]!.hold).toMatchObject({ until: '2026-10-16T03:30:00.000Z' });
    // One statement for the whole slice, on the message clock.
    expect(w.checkMany).toHaveBeenCalledTimes(1);
    expect(w.checkMany).toHaveBeenCalledWith(7, 'message', [1, 2, 3]);
    expect(w.check).not.toHaveBeenCalled();
  });

  it('reads a recipient without a contact on the workspace fallback clock, asked once for all of them', async () => {
    const w = fakeWindow({}, hold('2026-10-16T03:30:00.000Z'));
    const rows = [
      { id: 1, contactId: null },
      { id: 2, contactId: null },
      { id: 3, contactId: 3 },
    ];
    const out = await splitByQuietHours(w.service, 7, rows);
    expect(out.held.map((h) => h.row.id)).toEqual([1, 2]);
    expect(out.go.map((r) => r.id)).toEqual([3]);
    expect(w.check).toHaveBeenCalledTimes(1);
    expect(w.check).toHaveBeenCalledWith(7, 'message', {});
  });

  it('asks nothing for an empty slice and holds nobody when nothing is configured', async () => {
    const w = fakeWindow({});
    expect(await splitByQuietHours(w.service, 7, [])).toEqual({ go: [], held: [] });
    expect(w.checkMany).not.toHaveBeenCalled();
    expect(w.check).not.toHaveBeenCalled();
    const out = await splitByQuietHours(w.service, 7, [{ id: 1, contactId: 1 }]);
    expect(out.held).toEqual([]);
  });
});

describe('the wake-up of a held run', () => {
  const now = new Date('2026-10-15T16:00:00Z');

  it('waits until the opening plus a one second margin, never less than the margin', () => {
    expect(wakeDelayMs(new Date('2026-10-15T16:30:00Z'), now)).toBe(30 * 60_000 + WAKE_MARGIN_MS);
    // An opening already in the past is taken up at once (after the margin).
    expect(wakeDelayMs(new Date('2026-10-15T15:00:00Z'), now)).toBe(WAKE_MARGIN_MS);
  });

  it('names the job by broadcast and opening, so asking twice for one opening queues it once', () => {
    const a = wakeJobId('abc', new Date('2026-10-16T03:30:00.400Z'));
    const b = wakeJobId('abc', new Date('2026-10-16T03:30:00.900Z'));
    expect(a).toBe(b);
    expect(a).toBe(`abc-held-${Math.floor(Date.parse('2026-10-16T03:30:00Z') / 1000)}`);
    expect(wakeJobId('abc', new Date('2026-10-16T04:30:00Z'))).not.toBe(a);
  });

  it('queues a delayed job with that id, and reports (not throws) when the queue is down', async () => {
    const add = vi.fn(() => Promise.resolve({}));
    const onError = vi.fn();
    const at = new Date(Date.now() + 60_000);
    await scheduleWake({ add }, 'send', { orgId: 1 }, 'uuid-1', at, onError);
    expect(add).toHaveBeenCalledWith(
      'send',
      { orgId: 1 },
      expect.objectContaining({ jobId: wakeJobId('uuid-1', at), removeOnComplete: 100 }),
    );
    const delay = (add.mock.calls[0] as unknown as [string, unknown, { delay: number }])[2].delay;
    expect(delay).toBeGreaterThan(55_000);
    expect(onError).not.toHaveBeenCalled();

    const down = vi.fn(() => Promise.reject(new Error('redis down')));
    await scheduleWake({ add: down }, 'send', {}, 'uuid-1', at, onError);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('heldOf', () => {
  it('is nothing held for a broadcast with no summary', () => {
    expect(heldOf(new Map(), 5)).toEqual({ count: 0, next: null });
    const next = new Date('2026-10-16T03:30:00Z');
    expect(heldOf(new Map([[5, { count: 2, next }]]), 5)).toEqual({ count: 2, next });
  });
});
