import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type CreateTemplateInput } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { TemplatesService } from '../../../src/modules/message-templates/templates.service';

const ORG = 41;
const limitReached = () =>
  new AppError(ERROR_CODES.PLAN_LIMIT_REACHED, 'cap', HttpStatus.UNPROCESSABLE_ENTITY, [
    { path: 'limit', message: 'templates' },
  ]);

const input: CreateTemplateInput = {
  name: 'promo',
  language: 'en_US',
  metaCategory: 'UTILITY',
  templateType: 'standard',
  attachmentType: 'none',
  body: 'Hello {{1}}, your order is ready.',
  buttons: [],
  parameterFormat: 'POSITIONAL',
  connectionId: '00000000-0000-4000-8000-000000000001',
  submit: false,
} as CreateTemplateInput;

function build(assertCanAdd: ReturnType<typeof vi.fn>) {
  const repo = {
    nameTaken: vi.fn().mockResolvedValue(true), // stops the create right after the guard: proves it got that far
    insert: vi.fn(),
  };
  const db = { tx: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
  const waba = { resolveConnection: vi.fn().mockResolvedValue({ id: 7, conn: null, status: 'x' }) };
  const svc = new TemplatesService(
    db as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    waba as never,
    {} as never,
    {
      assertCanAdd,
      assertCanAddIn: (_tx: unknown, org: number, key: string) => assertCanAdd(org, key),
    } as never,
    {} as never,
    {} as never,
  );
  const run = () =>
    RequestContextStore.run(
      { requestId: 'r', orgId: ORG, actorType: 'user', actorId: 1, userId: 1 },
      () => svc.create(input),
    );
  return { run, repo };
}

describe('template create: plan cap on templates', () => {
  it('refuses with the 422 PLAN_LIMIT_REACHED and inserts nothing', async () => {
    const assertCanAdd = vi.fn().mockRejectedValue(limitReached());
    const { run, repo } = build(assertCanAdd);
    await expect(run()).rejects.toMatchObject({
      code: ERROR_CODES.PLAN_LIMIT_REACHED,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(assertCanAdd).toHaveBeenCalledWith(ORG, 'templates');
    expect(repo.nameTaken).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('lets the create continue when the cap allows one more', async () => {
    const assertCanAdd = vi.fn().mockResolvedValue(undefined);
    const { run, repo } = build(assertCanAdd);
    // The next step after the guard is the duplicate-name check: it is reached, so the guard did not block.
    await expect(run()).rejects.toBeInstanceOf(AppError);
    expect(assertCanAdd).toHaveBeenCalledWith(ORG, 'templates');
    expect(repo.nameTaken).toHaveBeenCalledTimes(1);
  });
});
