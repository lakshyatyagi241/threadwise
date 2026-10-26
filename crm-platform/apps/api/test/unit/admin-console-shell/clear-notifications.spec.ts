import { describe, expect, it, vi } from 'vitest';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { ShellUserService } from '../../../src/modules/admin-console-shell/shell-user.service';

/** The bell's Clear all, over fakes: the delete answers `deleted` rows, the publisher is a spy. */
function harness(deleted: number) {
  const publisher = { read: vi.fn(async () => undefined) };
  const db = {
    txAs: vi.fn(async (_scope: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        execute: vi.fn(async () => ({ rows: Array.from({ length: deleted }, () => ({ 1: 1 })) })),
      }),
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ShellUserService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    publisher as never,
  );
  const ctx = { orgId: 4, userId: 7, actorType: 'user' } as RequestContext;
  return { service, publisher, ctx };
}

describe('Clear all (the bell)', () => {
  it('tells the other tabs and devices of the caller that everything was read or removed', async () => {
    const { service, publisher, ctx } = harness(3);
    const out = await RequestContextStore.run(ctx, () => service.clearNotifications());
    expect(out).toEqual({ cleared: 3 });
    expect(publisher.read).toHaveBeenCalledWith(4, 7, 'all');
  });

  it('stays silent when nothing was there to clear', async () => {
    const { service, publisher, ctx } = harness(0);
    const out = await RequestContextStore.run(ctx, () => service.clearNotifications());
    expect(out).toEqual({ cleared: 0 });
    expect(publisher.read).not.toHaveBeenCalled();
  });
});
