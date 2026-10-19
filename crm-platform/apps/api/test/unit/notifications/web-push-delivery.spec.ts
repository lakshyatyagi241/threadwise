import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebPushDeliveryService } from '../../../src/modules/notifications/web-push-delivery.service';
import { WebPushProcessor } from '../../../src/modules/notifications/web-push.processor';
import { WebPushSender } from '../../../src/modules/notifications/web-push.sender';
import type { PushTarget } from '../../../src/modules/notifications/push-subscriptions.repository';
import { FakeWebPushProvider, useVapidEnv } from '../../support/web-push-fakes';

const ROW = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';

const target = (id: number, failureCount = 0): PushTarget => ({
  id,
  orgId: 4,
  userId: 7,
  uuid: `00000000-0000-4000-8000-00000000000${id}`,
  endpoint: `https://push.example.test/${id}/secret-endpoint-value`,
  p256dh: `p256dh-secret-${id}`,
  auth: `auth-secret-${id}`,
  failureCount,
});

function bellRow(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    uuid: ROW,
    type: 'new_message',
    title: 'New message from Asha',
    body: 'Is it shipped?',
    link: `/inbox?c=${CONV}`,
    data: { contactName: 'Asha Rao', preview: 'Is it shipped?', count: 1 },
    readAt: null,
    createdAt: new Date(),
    collapseKey: `msg:${CONV}`,
    eventCount: 1,
    subjectKind: 'conversation',
    subjectUuid: CONV,
    ...over,
  };
}

/** The delivery service over fakes: one bell row, a set of devices, a scripted push service, a presence flag. */
function harness(
  opts: {
    row?: ReturnType<typeof bellRow> | undefined | null;
    targets?: PushTarget[];
    visible?: boolean;
  } = {},
) {
  const provider = new FakeWebPushProvider();
  const targets = opts.targets ?? [target(1)];
  const calls = {
    success: [] as number[][],
    failure: [] as Array<{ id: number; revoke: boolean }>,
    only: [] as Array<readonly number[] | undefined>,
  };
  const db = { txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) => fn({})) };
  const notifications = {
    findForPush: vi.fn(async () => (opts.row === null ? undefined : (opts.row ?? bellRow()))),
  };
  const subscriptions = {
    liveTargets: vi.fn(async (_tx: unknown, _o: number, _u: number, only?: readonly number[]) => {
      calls.only.push(only);
      return only ? targets.filter((t) => only.includes(t.id)) : targets;
    }),
    recordSuccess: vi.fn(async (_tx: unknown, _o: number, ids: readonly number[]) => {
      calls.success.push([...ids]);
    }),
    recordFailure: vi.fn(async (_tx: unknown, _o: number, id: number, revoke: boolean) => {
      calls.failure.push({ id, revoke });
    }),
  };
  const presence = { isVisible: vi.fn(async () => opts.visible === true) };
  const sender = new WebPushSender(provider, db as never, subscriptions as never, {} as never);
  const delivery = new WebPushDeliveryService(
    db as never,
    notifications as never,
    subscriptions as never,
    sender,
    presence as never,
  );
  return { delivery, provider, calls, presence, notifications, subscriptions, sender };
}

describe('browser push delivery', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = useVapidEnv();
  });
  afterAll(() => restore());

  const job = { orgId: 4, userId: 7, notificationUuid: ROW };

  it('sends the push to each live device with title = contact name, one tag per conversation, and records success', async () => {
    const h = harness({ targets: [target(1), target(2)] });
    const out = await h.delivery.deliver(job);
    expect(out).toMatchObject({ status: 'done', sent: 2, failed: 0, retry: [] });
    expect(h.provider.sent).toHaveLength(2);
    const first = h.provider.sent[0]!;
    expect(first.payload).toMatchObject({
      title: 'Asha Rao',
      body: 'New message',
      tag: `conversation:${CONV}`,
      url: `/inbox?c=${CONV}`,
      notificationId: ROW,
      test: false,
    });
    expect(first.options.urgency).toBe('high');
    expect(first.options.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(h.calls.success).toEqual([[1, 2]]);
    expect(h.calls.failure).toEqual([]);
  });

  it('sends nothing when the person has a visible tab (the bell and toast cover them)', async () => {
    const h = harness({ visible: true });
    expect(await h.delivery.deliver(job)).toEqual({ status: 'skipped', reason: 'visible' });
    expect(h.provider.sent).toHaveLength(0);
    expect(h.notifications.findForPush).not.toHaveBeenCalled();
  });

  it('does not ask about the tab again on a retry: the first send decided', async () => {
    const h = harness({ visible: true });
    const out = await h.delivery.deliver({ ...job, only: [1] });
    expect(out.status).toBe('done');
    expect(h.presence.isVisible).not.toHaveBeenCalled();
  });

  it('is invisible when the deployment has no VAPID keys', async () => {
    const h = harness();
    h.provider.enabled = false;
    expect(await h.delivery.deliver(job)).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(h.provider.sent).toHaveLength(0);
    expect(h.presence.isVisible).not.toHaveBeenCalled();
  });

  it('sends nothing for a row that was pruned, already read, or has no device', async () => {
    expect(await harness({ row: null }).delivery.deliver(job)).toEqual({
      status: 'skipped',
      reason: 'gone',
    });
    const read = harness({ row: bellRow({ readAt: new Date() }) });
    expect(await read.delivery.deliver(job)).toEqual({ status: 'skipped', reason: 'read' });
    expect(read.provider.sent).toHaveLength(0);
    const none = harness({ targets: [] });
    expect(await none.delivery.deliver(job)).toEqual({ status: 'skipped', reason: 'no_devices' });
  });

  it('revokes a device the push service says is gone (404 and 410) and keeps sending to the others', async () => {
    const h = harness({ targets: [target(1), target(2), target(3)] });
    h.provider.answer(target(1).endpoint, { ok: false, gone: true, status: 410 });
    h.provider.answer(target(3).endpoint, { ok: false, gone: true, status: 404 });
    const out = await h.delivery.deliver(job);
    expect(out).toMatchObject({ status: 'done', sent: 1, failed: 2, retry: [] });
    expect(h.calls.success).toEqual([[2]]);
    expect(h.calls.failure).toEqual([
      { id: 1, revoke: true },
      { id: 3, revoke: true },
    ]);
  });

  it('asks for a retry of only the devices the push service could not take now (429 and 5xx)', async () => {
    const h = harness({ targets: [target(1), target(2), target(3)] });
    h.provider.answer(target(1).endpoint, {
      ok: false,
      gone: false,
      retryable: true,
      status: 429,
      retryAfterSeconds: 30,
    });
    h.provider.answer(target(3).endpoint, {
      ok: false,
      gone: false,
      retryable: true,
      status: 503,
    });
    const out = await h.delivery.deliver(job);
    expect(out).toMatchObject({ status: 'done', sent: 1, retry: [1, 3] });
    // Not revoked: a busy push service is not a dead device. The failure is counted.
    expect(h.calls.failure).toEqual([
      { id: 1, revoke: false },
      { id: 3, revoke: false },
    ]);
    // The retry goes to those two only, so device 2 does not get the push twice.
    h.provider.answer(target(1).endpoint, { ok: true });
    h.provider.answer(target(3).endpoint, { ok: true });
    const again = await h.delivery.deliver({
      ...job,
      only: out.status === 'done' ? out.retry : [],
    });
    expect(again).toMatchObject({ status: 'done', sent: 2 });
    expect(h.provider.sent.filter((s) => s.target.endpoint === target(2).endpoint)).toHaveLength(1);
  });

  it('revokes a device whose keys the push service no longer accepts (401 and 403), but not one that merely refused the payload', async () => {
    const h = harness({ targets: [target(1), target(2)] });
    h.provider.answer(target(1).endpoint, {
      ok: false,
      gone: false,
      retryable: false,
      status: 403,
    });
    h.provider.answer(target(2).endpoint, {
      ok: false,
      gone: false,
      retryable: false,
      status: 413,
    });
    await h.delivery.deliver(job);
    expect(h.calls.failure).toEqual([
      { id: 1, revoke: true },
      { id: 2, revoke: false },
    ]);
  });

  it('gives up on a device after ten failures in a row', async () => {
    const h = harness({ targets: [target(1, 9)] });
    h.provider.answer(target(1).endpoint, { ok: false, gone: false, retryable: true, status: 500 });
    await h.delivery.deliver(job);
    expect(h.calls.failure).toEqual([{ id: 1, revoke: true }]);
  });

  it('treats a bug in the adapter as a retryable failure for that device only', async () => {
    const h = harness({ targets: [target(1), target(2)] });
    h.provider.answer(target(1).endpoint, () => {
      throw new Error('boom');
    });
    const out = await h.delivery.deliver(job);
    expect(out).toMatchObject({ status: 'done', sent: 1, retry: [1] });
  });

  it('never puts an endpoint or a key in what it records or returns', async () => {
    const h = harness();
    h.provider.answer(target(1).endpoint, { ok: false, gone: true, status: 410 });
    const out = await h.delivery.deliver(job);
    const seen = JSON.stringify([out, h.calls]);
    expect(seen).not.toContain('secret-endpoint-value');
    expect(seen).not.toContain('p256dh-secret');
    expect(seen).not.toContain('auth-secret');
  });
});

describe('the push queue processor', () => {
  const makeJob = (attemptsMade: number) => {
    const data = { orgId: 4, userId: 7, notificationUuid: ROW };
    return {
      data,
      attemptsMade,
      opts: { attempts: 4 },
      updateData: vi.fn(async () => undefined),
    };
  };

  it('fails the job to retry later, narrowed to the devices that failed', async () => {
    const delivery = {
      deliver: vi.fn(async () => ({ status: 'done', sent: 1, failed: 1, retry: [2] })),
    };
    const processor = new WebPushProcessor(delivery as never);
    const job = makeJob(0);
    await expect(processor.process(job as never)).rejects.toThrow(/1 device/);
    expect(job.updateData).toHaveBeenCalledWith({ ...job.data, only: [2] });
  });

  it('drops the job quietly after the last attempt', async () => {
    const delivery = {
      deliver: vi.fn(async () => ({ status: 'done', sent: 0, failed: 1, retry: [2] })),
    };
    const processor = new WebPushProcessor(delivery as never);
    const job = makeJob(3);
    await expect(processor.process(job as never)).resolves.toBeUndefined();
    expect(job.updateData).not.toHaveBeenCalled();
  });

  it('completes when there is nothing to retry or the push was skipped', async () => {
    for (const outcome of [
      { status: 'done', sent: 1, failed: 0, retry: [] },
      { status: 'skipped', reason: 'visible' },
    ]) {
      const processor = new WebPushProcessor({ deliver: vi.fn(async () => outcome) } as never);
      await expect(processor.process(makeJob(0) as never)).resolves.toBeUndefined();
    }
  });
});
