import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type CreateScheduleInput } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { ScheduleCreateService } from '../../../src/modules/scheduled-queue-warmer/schedule-create.service';

const ORG = 52;
const limitReached = () =>
  new AppError(ERROR_CODES.PLAN_LIMIT_REACHED, 'cap', HttpStatus.UNPROCESSABLE_ENTITY, [
    { path: 'limit', message: 'scheduled_messages' },
  ]);

// An unknown timezone: the first check after the plan guard refuses it, so nothing is ever written.
const input = { name: 'n', timezone: 'Nowhere/Land', sendTime: '10:00' } as CreateScheduleInput;

function build(assertCanAdd: ReturnType<typeof vi.fn>) {
  const db = { tx: vi.fn(), txAs: vi.fn() };
  const plans = { assertFeature: vi.fn().mockResolvedValue(undefined) };
  const audience = { resolve: vi.fn() };
  const svc = new ScheduleCreateService(
    db as never,
    plans as never,
    { assertCanAdd } as never,
    audience as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const run = () =>
    RequestContextStore.run(
      { requestId: 'r', orgId: ORG, actorType: 'user', actorId: 1, userId: 1 },
      () => svc.create(input),
    );
  return { run, db, plans, audience };
}

describe('schedule create: plan cap on scheduled messages', () => {
  it('refuses with the 422 PLAN_LIMIT_REACHED and writes nothing', async () => {
    const assertCanAdd = vi.fn().mockRejectedValue(limitReached());
    const { run, db, audience } = build(assertCanAdd);
    await expect(run()).rejects.toMatchObject({
      code: ERROR_CODES.PLAN_LIMIT_REACHED,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(assertCanAdd).toHaveBeenCalledWith(ORG, 'scheduled_messages');
    expect(audience.resolve).not.toHaveBeenCalled();
    expect(db.tx).not.toHaveBeenCalled();
  });

  it('goes on to the next checks when the cap allows one more', async () => {
    const assertCanAdd = vi.fn().mockResolvedValue(undefined);
    const { run, plans } = build(assertCanAdd);
    await expect(run()).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(plans.assertFeature).toHaveBeenCalledWith(ORG, 'scheduled_messages');
    expect(assertCanAdd).toHaveBeenCalledWith(ORG, 'scheduled_messages');
  });
});
