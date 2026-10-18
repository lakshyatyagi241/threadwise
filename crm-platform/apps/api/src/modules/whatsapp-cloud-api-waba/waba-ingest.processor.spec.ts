import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { sealJson } from '../../common/crypto/sealed-json';
import { WabaIngestProcessor } from './waba-ingest.processor';

/**
 * The WhatsApp ingest job carries message text and phone numbers, so it is sealed (ASYNC-075/079). A job queued before the change
 * still carries the plain `changes`; it must be worked too, so a rolling deploy strands nothing.
 */
const crypto = {
  encrypt: (v: string) => `sealed:${Buffer.from(v).toString('base64')}`,
  decrypt: (v: string) => {
    if (!v.startsWith('sealed:')) throw new Error('bad blob');
    return Buffer.from(v.slice(7), 'base64').toString();
  },
};
const changes = [{ field: 'messages', phoneNumberId: '1', text: 'hello' }];
const build = (process = vi.fn().mockResolvedValue({ handled: 1, dropped: 0 })) => ({
  processor: new WabaIngestProcessor({ process } as never, crypto as never),
  process,
});

describe('WabaIngestProcessor', () => {
  it('opens a sealed job and ingests its changes', async () => {
    const { processor, process } = build();
    await processor.process({ data: { sealed: sealJson(crypto, { changes }) } } as never);
    expect(process).toHaveBeenCalledWith(changes);
  });

  it('still works a job queued before the payload was sealed', async () => {
    const { processor, process } = build();
    await processor.process({ data: { changes } } as never);
    expect(process).toHaveBeenCalledWith(changes);
  });

  it('fails a payload it cannot open for good: it would not open on the next attempt either', async () => {
    const { processor } = build();
    await expect(processor.process({ data: { sealed: 'nope' } } as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('fails a rule the data broke (AppError) for good, and lets any other failure retry', async () => {
    const rule = build(vi.fn().mockRejectedValue(new AppError(ERROR_CODES.VALIDATION_FAILED, 'x')));
    await expect(rule.processor.process({ data: { changes } } as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const down = build(vi.fn().mockRejectedValue(new Error('db down')));
    const err = await down.processor.process({ data: { changes } } as never).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });
});
