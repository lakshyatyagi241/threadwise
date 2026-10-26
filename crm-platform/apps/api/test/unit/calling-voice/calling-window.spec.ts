import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { SendWindowService } from '../../../src/modules/compliance-center';
import { CallingWindowService } from '../../../src/modules/calling-voice/calling-window.service';
import type { CallsRepository } from '../../../src/modules/calling-voice/calls.repository';

const TARGET = { contactId: 3, conversationId: null, phone: '919876543210' };
const HOLD = {
  decision: 'hold',
  reason: 'quiet_hours',
  until: '2030-10-16T03:30:00.000Z',
  zone: 'Asia/Kolkata',
  zoneSource: 'contact_field',
} as const;

/** The service with fakes: the window decision and whether the person reached us in the last 24 hours. */
function rig(decision: unknown, answered: boolean) {
  const check = vi.fn().mockResolvedValue(decision);
  const contactedUsRecently = vi.fn().mockResolvedValue(answered);
  const db = { tx: (fn: (tx: unknown) => unknown) => fn({}) } as unknown as DatabaseService;
  const service = new CallingWindowService(
    db,
    { contactedUsRecently } as unknown as CallsRepository,
    { check } as unknown as SendWindowService,
  );
  return { service, check, contactedUsRecently };
}

describe('CallingWindowService.assertOpen', () => {
  it('lets a call through when the window is open, without looking at the 24 hour exemption', async () => {
    const { service, check, contactedUsRecently } = rig({ decision: 'allow' }, false);
    await expect(service.assertOpen(7, TARGET)).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledWith(7, 'call', { contactId: 3, phone: '919876543210' });
    expect(contactedUsRecently).not.toHaveBeenCalled();
  });

  it('refuses a call inside the hours, naming the instant the window opens', async () => {
    const { service } = rig(HOLD, false);
    await expect(service.assertOpen(7, TARGET)).rejects.toMatchObject({
      code: 'CALL_OUTSIDE_WINDOW',
      message: expect.stringContaining('2030-10-16T03:30:00.000Z'),
      details: [{ path: 'opensAt', message: HOLD.until }],
    });
  });

  it('lets a call back through when the person reached us in the last 24 hours', async () => {
    const { service, contactedUsRecently } = rig(HOLD, true);
    await expect(service.assertOpen(7, TARGET)).resolves.toBeUndefined();
    expect(contactedUsRecently).toHaveBeenCalledWith(expect.anything(), 7, {
      conversationId: null,
      contactId: 3,
      phone: '919876543210',
      hours: 24,
    });
  });
});

describe('CallingWindowService.closedUntil', () => {
  it('is null when the window is open, so the preflight can say allowed', async () => {
    const { service } = rig({ decision: 'allow' }, false);
    await expect(service.closedUntil(7, TARGET)).resolves.toBeNull();
  });

  it('gives the instant the window opens when the call is refused', async () => {
    const { service } = rig(HOLD, false);
    await expect(service.closedUntil(7, TARGET)).resolves.toBe(HOLD.until);
  });

  it('is null when the person reached us in the last 24 hours, even inside the hours', async () => {
    const { service } = rig(HOLD, true);
    await expect(service.closedUntil(7, TARGET)).resolves.toBeNull();
  });
});
