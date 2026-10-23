import { describe, expect, it, vi } from 'vitest';
import { AIAG_PREVIEW_MAX } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { SourcesService } from '../../../src/modules/ai-agents-training/sources.service';

const U = '11111111-1111-4111-8111-111111111111';

function make(row: Record<string, unknown> | undefined) {
  const repo = { findByUuid: vi.fn().mockResolvedValue(row) };
  const db = { tx: (fn: (tx: unknown) => unknown) => fn({}) };
  const svc = new SourcesService(
    db as never,
    {} as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return svc;
}
const base = {
  uuid: U,
  kind: 'text',
  label: 'Hours',
  url: null,
  status: 'ready',
  question: null,
  answer: null,
};
const run = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'r', orgId: 1, actorType: 'user', actorId: null, userId: 1 },
    fn,
  );

describe('SourcesService.preview', () => {
  it('returns the text of a pasted entry whole when it is short', async () => {
    const out = await run(() => make({ ...base, content: 'Open 9 to 5' }).preview(U));
    expect(out).toMatchObject({ id: U, kind: 'text', text: 'Open 9 to 5', truncated: false });
  });

  it('cuts a long page and says so', async () => {
    const out = await run(() =>
      make({ ...base, kind: 'url', content: 'x'.repeat(AIAG_PREVIEW_MAX + 5) }).preview(U),
    );
    expect(out.text).toHaveLength(AIAG_PREVIEW_MAX);
    expect(out.truncated).toBe(true);
  });

  it('gives a Q&A pair as question and answer, and an unread page as no text', async () => {
    const qa = await run(() =>
      make({ ...base, kind: 'qa', content: null, question: 'Hours?', answer: '9 to 5' }).preview(U),
    );
    expect(qa).toMatchObject({ question: 'Hours?', answer: '9 to 5', text: null });
    const wait = await run(() =>
      make({ ...base, kind: 'url', status: 'processing', content: null }).preview(U),
    );
    expect(wait.text).toBeNull();
  });

  it('is not found for an unknown entry', async () => {
    await expect(run(() => make(undefined).preview(U))).rejects.toThrow();
  });
});
