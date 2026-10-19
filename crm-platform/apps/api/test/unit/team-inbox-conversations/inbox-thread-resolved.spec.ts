import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type SendMessageInput } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { InboxThreadService } from '../../../src/modules/team-inbox-conversations/inbox-thread.service';

const CONV = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const CLIENT = '9b1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e12';
const ctx: RequestContext = { requestId: 'r', orgId: 1, actorType: 'user', actorId: 5, userId: 5 };

function setup(status: string) {
  const enqueueOutbound = vi.fn().mockResolvedValue({ message: { id: 'm1' } });
  const retryOutbound = vi.fn().mockResolvedValue({ id: 'm1' });
  const record = async () => ({
    id: 1,
    status,
    assigneeUserId: 5,
    assigneeTeamId: null,
    channelOwnerUserId: null,
  });
  const service = new InboxThreadService(
    { tx: (fn: (t: unknown) => unknown) => fn({}) } as never,
    { recordByUuid: record, recordByMessageUuid: record } as never,
    {
      viewer: async () => ({}),
      assertVisible: () => undefined,
      canSee: () => true,
      assertCan: async () => undefined,
      assertNotAssignedToOther: () => undefined,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { enqueueOutbound, retryOutbound } as never,
    { previewLinker: async () => async () => null } as never,
  );
  const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);
  return { service, run, enqueueOutbound, retryOutbound };
}

const text = { kind: 'text', clientMessageId: CLIENT, body: 'hi' } as SendMessageInput;
const reaction = {
  kind: 'reaction',
  clientMessageId: CLIENT,
  targetMessageId: CLIENT,
  emoji: '👍',
} as SendMessageInput;

describe('an agent message to a resolved thread', () => {
  it.each(['resolved', 'closed'])(
    'is refused for a %s thread, whatever the kind',
    async (status) => {
      const { service, run, enqueueOutbound } = setup(status);
      for (const input of [text, reaction]) {
        await expect(run(() => service.send(CONV, input))).rejects.toMatchObject({
          code: ERROR_CODES.CONVERSATION_RESOLVED,
          status: 422,
        });
      }
      expect(enqueueOutbound).not.toHaveBeenCalled();
    },
  );

  it('refuses a template picker and a retry too', async () => {
    const { service, run, retryOutbound } = setup('resolved');
    await expect(run(() => service.listTemplates(CONV, {}))).rejects.toMatchObject({
      code: ERROR_CODES.CONVERSATION_RESOLVED,
    });
    await expect(run(() => service.retry(CLIENT))).rejects.toMatchObject({
      code: ERROR_CODES.CONVERSATION_RESOLVED,
    });
    expect(retryOutbound).not.toHaveBeenCalled();
  });

  it.each(['open', 'pending', 'snoozed'])('is sent as before on a %s thread', async (status) => {
    const { service, run, enqueueOutbound } = setup(status);
    await run(() => service.send(CONV, text));
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
  });
});
