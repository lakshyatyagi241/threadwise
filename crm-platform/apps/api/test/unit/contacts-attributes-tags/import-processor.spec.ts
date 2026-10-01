import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import {
  ContactImportProcessor,
  type ContactImportJobData,
} from '../../../src/modules/crm/contact-import/contact-import.processor';
import type { ContactImportEngine } from '../../../src/modules/crm/contact-import/contact-import.engine';

const job = (data: ContactImportJobData) => ({ data }) as Job<ContactImportJobData>;
const engineOf = (run: ContactImportEngine['run']) => ({ run }) as unknown as ContactImportEngine;

describe('the con-import queue processor (WD-CON-027)', () => {
  it('runs the engine for the tenant and user in the job payload, with a request context a worker would not otherwise have', async () => {
    let seen: { args: unknown[]; ctx: ReturnType<typeof RequestContextStore.peek> } | undefined;
    const p = new ContactImportProcessor(
      engineOf(async (...args) => {
        seen = { args, ctx: RequestContextStore.peek() };
      }),
    );
    await p.process(job({ orgId: 7, userId: 3, jobId: 42 }));
    expect(seen?.args).toEqual([7, 3, 42]);
    // audit and outbox rows written by the engine carry this tenant and actor
    expect(seen?.ctx).toMatchObject({
      orgId: 7,
      actorType: 'user',
      actorId: 3,
      userId: 3,
      requestId: 'con-import-42',
    });
  });

  it('a rule the data broke (an AppError) is not retried: BullMQ is told the failure is final', async () => {
    const p = new ContactImportProcessor(
      engineOf(async () => {
        throw AppError.notFound('Contact group', 'x');
      }),
    );
    await expect(p.process(job({ orgId: 1, userId: 1, jobId: 1 }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('anything else (a dropped connection) is rethrown as it is, so BullMQ retries with backoff', async () => {
    const boom = new Error('connection reset');
    const p = new ContactImportProcessor(
      engineOf(async () => {
        throw boom;
      }),
    );
    await expect(p.process(job({ orgId: 1, userId: 1, jobId: 1 }))).rejects.toBe(boom);
  });
});
