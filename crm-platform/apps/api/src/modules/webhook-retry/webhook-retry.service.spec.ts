import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { WebhookRetryProcessor } from './webhook-retry.processor';
import { WebhookRetryService } from './webhook-retry.service';

/**
 * ASYNC-011/017/018: a webhook may answer 2xx only when the event is durably kept. A store that failed is deferred to a queue with
 * backoff, so the provider keeps its 200 (one workspace's failure cannot make the provider throttle the shared webhook) and the event
 * is still retried for about 40 minutes and then kept as a failed job for replay.
 */
function build() {
  const queue = { add: vi.fn().mockResolvedValue({}) };
  const svc = new WebhookRetryService(queue as never);
  return { svc, queue };
}

describe('WebhookRetryService', () => {
  it('queues the payload under its channel', async () => {
    const { svc, queue } = build();
    await svc.defer('telegram', { orgId: 1 });
    expect(queue.add).toHaveBeenCalledWith('retry', { channel: 'telegram', payload: { orgId: 1 } });
  });

  it('lets a failed enqueue surface, so the webhook can answer 503 instead of a 200 that kept nothing', async () => {
    const { svc, queue } = build();
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(svc.defer('telegram', {})).rejects.toThrow('redis down');
  });

  it('runs the handler the channel registered', async () => {
    const { svc } = build();
    const handler = vi.fn().mockResolvedValue(undefined);
    svc.register('viber', handler);
    await svc.run('viber', { a: 1 });
    expect(handler).toHaveBeenCalledWith({ a: 1 });
  });

  it('refuses a channel nobody registered, for good', async () => {
    const { svc } = build();
    await expect(svc.run('nope', {})).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('WebhookRetryProcessor', () => {
  const job = (channel: string) => ({ data: { channel, payload: { x: 1 } } }) as never;

  it('hands the job to the service', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await new WebhookRetryProcessor({ run } as never).process(job('line'));
    expect(run).toHaveBeenCalledWith('line', { x: 1 });
  });

  it('fails a rule the data broke (AppError) for good: a retry would fail the same way', async () => {
    const run = vi.fn().mockRejectedValue(new AppError(ERROR_CODES.VALIDATION_FAILED, 'bad'));
    await expect(
      new WebhookRetryProcessor({ run } as never).process(job('line')),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('lets any other failure through so the queue retries it with backoff', async () => {
    const run = vi.fn().mockRejectedValue(new Error('db down'));
    const err = await new WebhookRetryProcessor({ run } as never).process(job('line')).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });
});
