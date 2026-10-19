import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { CryptoService } from '../../common/crypto/crypto.service';
import { WebhookRetryProcessor } from './webhook-retry.processor';
import { WebhookRetryService } from './webhook-retry.service';

/**
 * ASYNC-011/017/018: a webhook may answer 2xx only when the event is durably kept. A store that failed is deferred to a queue with
 * backoff, so the provider keeps its 200 (one workspace's failure cannot make the provider throttle the shared webhook) and the event
 * is still retried for about 40 minutes and then kept as a failed job for replay.
 */
function build() {
  const queue = { add: vi.fn().mockResolvedValue({}) };
  const crypto = new CryptoService({
    get: (k: string) =>
      k === 'CREDENTIALS_ENCRYPTION_KEY' ? Buffer.alloc(32, 7).toString('base64') : undefined,
  } as never);
  const svc = new WebhookRetryService(queue as never, crypto);
  return { svc, queue };
}

describe('WebhookRetryService', () => {
  it('queues the payload under its channel, sealed: the queue (Redis) never holds the message text', async () => {
    const { svc, queue } = build();
    await svc.defer('telegram', { orgId: 1, text: 'my card number is 4111' });
    const [name, data] = queue.add.mock.calls[0]!;
    expect(name).toBe('retry');
    expect(data.channel).toBe('telegram');
    expect(JSON.stringify(data)).not.toContain('4111');
    expect(JSON.stringify(data)).not.toContain('my card');
  });

  it('lets a failed enqueue surface, so the webhook can answer 503 instead of a 200 that kept nothing', async () => {
    const { svc, queue } = build();
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(svc.defer('telegram', {})).rejects.toThrow('redis down');
  });

  it('runs the handler the channel registered, with the payload unsealed', async () => {
    const { svc, queue } = build();
    const handler = vi.fn().mockResolvedValue(undefined);
    svc.register('viber', handler);
    await svc.defer('viber', { a: 1, text: 'hi' });
    const data = queue.add.mock.calls[0]![1];
    await svc.run('viber', data.sealed);
    expect(handler).toHaveBeenCalledWith({ a: 1, text: 'hi' });
  });

  it('refuses a channel nobody registered, for good', async () => {
    const { svc } = build();
    await expect(svc.run('nope', 'x')).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('refuses a payload it cannot open, for good: retrying a sealed blob that does not decrypt would fail the same way', async () => {
    const { svc } = build();
    svc.register('viber', vi.fn());
    await expect(svc.run('viber', 'not-a-sealed-payload')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('WebhookRetryProcessor', () => {
  const job = (channel: string) => ({ data: { channel, sealed: 'sealed-blob' } }) as never;

  it('hands the job to the service', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await new WebhookRetryProcessor({ run } as never).process(job('line'));
    expect(run).toHaveBeenCalledWith('line', 'sealed-blob');
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
