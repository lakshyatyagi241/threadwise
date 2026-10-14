/**
 * The `ai_assistants` plan flag on widgets: a widget in AI (or both) mode attaches an assistant, so the plan must include AI
 * assistants. The refusal is the shared 422 PLAN_FEATURE_LOCKED and comes before any lookup or write; other modes never ask.
 */
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { WidgetsService } from '../../../src/modules/chatbot-widget/widgets.service';

const ORG = 7;
const as = <T>(v: unknown) => v as T;
const none = {} as never;
const LOCKED = new AppError(
  ERROR_CODES.PLAN_FEATURE_LOCKED,
  'locked',
  HttpStatus.UNPROCESSABLE_ENTITY,
);

function setup(assertFeature: ReturnType<typeof vi.fn>) {
  const findByUuid = vi.fn().mockResolvedValue({ id: 99 });
  const svc = new WidgetsService(
    none,
    none,
    none,
    none,
    as({ get: vi.fn() }),
    as({ findByUuid }),
    as({ isEnabled: vi.fn() }),
    none,
    as({ assertFeature }),
    none,
  );
  const resolve = (mode: string, assistantId?: string) =>
    (
      svc as never as { resolveAssistant: (...a: unknown[]) => Promise<number | null> }
    ).resolveAssistant({}, ORG, { mode, assistantId });
  return { resolve, findByUuid };
}

describe('widgets: ai_assistants plan feature', () => {
  it('AI mode with the feature on resolves the assistant', async () => {
    const assertFeature = vi.fn().mockResolvedValue(undefined);
    const { resolve } = setup(assertFeature);
    await expect(resolve('ai', 'a-uuid')).resolves.toBe(99);
    expect(assertFeature).toHaveBeenCalledWith(ORG, 'ai_assistants');
  });

  it('AI mode with the feature off is locked, before the assistant lookup', async () => {
    const assertFeature = vi.fn().mockRejectedValue(LOCKED);
    const { resolve, findByUuid } = setup(assertFeature);
    await expect(resolve('both', 'a-uuid')).rejects.toBe(LOCKED);
    expect(findByUuid).not.toHaveBeenCalled();
  });

  it('a non-AI mode never asks the gate', async () => {
    const assertFeature = vi.fn();
    const { resolve } = setup(assertFeature);
    await expect(resolve('whatsapp')).resolves.toBeNull();
    expect(assertFeature).not.toHaveBeenCalled();
  });
});
