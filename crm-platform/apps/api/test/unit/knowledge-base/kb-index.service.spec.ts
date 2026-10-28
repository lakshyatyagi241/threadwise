import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { KbIndexService } from '../../../src/modules/knowledge-base/kb-index.service';
import { MAX_CHUNKS_PER_SOURCE } from '../../../src/modules/knowledge-base/kb.rules';

const qa = (n: number) => `Q: question ${n}\nA: answer ${n}`;

function build(content: string) {
  const chunks = {
    sourceToIndex: vi.fn(async () => ({
      id: 7,
      assistantId: 3,
      kind: 'text',
      content,
      question: null,
      answer: null,
    })),
    replaceForSource: vi.fn(async () => undefined),
  };
  const service = new KbIndexService(chunks as never);
  return { service, chunks };
}

describe('KbIndexService.indexSource', () => {
  it('queues the passages of an entry within the cap', async () => {
    const { service, chunks } = build(`${qa(1)}\n\n${qa(2)}`);
    await service.indexSource({} as never, 1, 7);
    expect(chunks.replaceForSource).toHaveBeenCalledTimes(1);
    expect(chunks.replaceForSource.mock.calls[0]![4]).toHaveLength(2);
  });

  it('refuses an entry that cuts into more passages than the cap, with the count, and writes nothing', async () => {
    const total = MAX_CHUNKS_PER_SOURCE + 50;
    const content = Array.from({ length: total }, (_, i) => qa(i)).join('\n\n');
    const { service, chunks } = build(content);
    const err = await service.indexSource({} as never, 1, 7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify((err as AppError).details)).toContain(`${total} passages`);
    expect(chunks.replaceForSource).not.toHaveBeenCalled();
  });

  it('passageRefusal is null at the cap and names the count above it', () => {
    const { service } = build('');
    const atCap = Array.from({ length: MAX_CHUNKS_PER_SOURCE }, (_, i) => qa(i)).join('\n\n');
    expect(service.passageRefusal(atCap)).toBeNull();
    const over = Array.from({ length: MAX_CHUNKS_PER_SOURCE + 1 }, (_, i) => qa(i)).join('\n\n');
    expect(service.passageRefusal(over)).toContain(`${MAX_CHUNKS_PER_SOURCE + 1} passages`);
  });
});
