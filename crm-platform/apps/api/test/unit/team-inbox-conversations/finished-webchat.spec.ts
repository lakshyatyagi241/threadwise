import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type ConversationStatus } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { InboxConversationsService } from '../../../src/modules/team-inbox-conversations/inbox-conversations.service';
import { InboxTriageService } from '../../../src/modules/team-inbox-conversations/inbox-triage.service';

/**
 * A resolved or closed web chat is final for an agent: no status route, snooze or spam mark brings it back to live. The other channels
 * keep every move. The guard runs before any write, so the repository's write is a sentinel that proves the guard let the call through.
 */

const CONV = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const ctx: RequestContext = { requestId: 'r', orgId: 1, actorType: 'user', actorId: 5, userId: 5 };
const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);
const PASSED = 'reached the write';

function locked(channelKind: string, status: ConversationStatus) {
  return {
    id: 1,
    uuid: CONV,
    channelId: 3,
    channelKind,
    status,
    assigneeUserId: 5,
    assigneeTeamId: null,
    assigneeAgentId: null,
    channelOwnerUserId: null,
    resolvedAt: status === 'resolved' || status === 'closed' ? '2026-10-20T10:00:00.000Z' : null,
    rowVersion: 4,
    handling: null,
    assignedSource: null,
    contactId: null,
  };
}

/** The dependencies a status or triage call touches before its write, all allowing the call. */
function access() {
  return {
    viewer: async () => ({}),
    assertVisible: () => undefined,
    assertCan: async () => undefined,
    assertNotAssignedToOther: () => undefined,
  } as never;
}

function setStatusService(row: ReturnType<typeof locked>) {
  const setStatus = vi.fn(async () => {
    throw new Error(PASSED);
  });
  const service = new InboxConversationsService(
    { tx: (fn: (t: unknown) => unknown) => fn({}) } as never,
    {
      lockByUuid: async () => row,
      setStatus,
      byUuid: async () => null,
      userUuid: async () => null,
    } as never,
    { append: async () => undefined } as never,
    access(),
    {} as never,
    { record: async () => undefined } as never,
    { emit: async () => undefined } as never,
    { conversationChanged: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    [] as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, setStatus };
}

function triageService(row: ReturnType<typeof locked>) {
  const snooze = vi.fn(async () => {
    throw new Error(PASSED);
  });
  const markSpam = vi.fn(async () => {
    throw new Error(PASSED);
  });
  const repo = {
    lockByUuid: async () => row,
    byUuid: async () => ({ snoozedUntil: null, rowVersion: row.rowVersion }),
    snooze,
    markSpam,
  };
  const service = new InboxTriageService(
    { retry: { tx: (fn: (t: unknown) => unknown) => fn({}) } } as never,
    repo as never,
    { append: async () => undefined } as never,
    access(),
    { record: async () => undefined } as never,
    { emit: async () => undefined } as never,
    { conversationChanged: async () => undefined, publish: async () => undefined } as never,
  );
  return { service, snooze, markSpam };
}

const UNTIL = new Date(Date.now() + 3_600_000).toISOString();

describe('a finished web chat cannot be reopened', () => {
  it.each(['resolved', 'closed'] as const)('refuses a reopen of a %s web chat', async (status) => {
    const { service, setStatus } = setStatusService(locked('webchat', status));
    await expect(
      run(() => service.setStatus(CONV, { rowVersion: 4, status: 'open' })),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONVERSATION_STATUS_INVALID, status: 422 });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'closed'] as const)(
    'keeps the other moves of a %s web chat (resolved and closed move between each other)',
    async (status) => {
      const { service, setStatus } = setStatusService(locked('webchat', status));
      const other = status === 'resolved' ? 'closed' : 'resolved';
      await expect(
        run(() => service.setStatus(CONV, { rowVersion: 4, status: other })),
      ).rejects.toThrow(PASSED);
      expect(setStatus).toHaveBeenCalledOnce();
    },
  );

  it.each(['resolved', 'closed'] as const)(
    'still reopens a %s conversation on any other channel',
    async (status) => {
      const { service, setStatus } = setStatusService(locked('whatsapp_cloud', status));
      await expect(
        run(() => service.setStatus(CONV, { rowVersion: 4, status: 'open' })),
      ).rejects.toThrow(PASSED);
      expect(setStatus).toHaveBeenCalledOnce();
    },
  );

  it('lets a snoozed web chat wake to open as before', async () => {
    const { service, setStatus } = setStatusService(locked('webchat', 'snoozed'));
    await expect(
      run(() => service.setStatus(CONV, { rowVersion: 4, status: 'open' })),
    ).rejects.toThrow(PASSED);
    expect(setStatus).toHaveBeenCalledOnce();
  });
});

describe('a finished web chat cannot be snoozed (it would wake as open)', () => {
  it.each(['resolved', 'closed'] as const)('refuses a snooze of a %s web chat', async (status) => {
    const { service, snooze } = triageService(locked('webchat', status));
    await expect(
      run(() => service.snooze(CONV, { until: UNTIL, rowVersion: 4 })),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONVERSATION_STATUS_INVALID, status: 422 });
    expect(snooze).not.toHaveBeenCalled();
  });

  it('still snoozes a resolved conversation on another channel', async () => {
    const { service, snooze } = triageService(locked('email', 'resolved'));
    await expect(run(() => service.snooze(CONV, { until: UNTIL, rowVersion: 4 }))).rejects.toThrow(
      PASSED,
    );
    expect(snooze).toHaveBeenCalledOnce();
  });
});

describe('a finished web chat cannot be marked as spam (taking it off spam is a reopen)', () => {
  it.each(['resolved', 'closed'] as const)(
    'refuses a spam mark on a %s web chat',
    async (status) => {
      const { service, markSpam } = triageService(locked('webchat', status));
      await expect(run(() => service.markSpam(CONV, { rowVersion: 4 }))).rejects.toMatchObject({
        code: ERROR_CODES.CONVERSATION_STATUS_INVALID,
        status: 422,
      });
      expect(markSpam).not.toHaveBeenCalled();
    },
  );

  it('marks an open web chat as spam as before', async () => {
    const { service, markSpam } = triageService(locked('webchat', 'open'));
    await expect(run(() => service.markSpam(CONV, { rowVersion: 4 }))).rejects.toThrow(PASSED);
    expect(markSpam).toHaveBeenCalledOnce();
  });
});
