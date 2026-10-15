import { describe, expect, it } from 'vitest';
import {
  createWaDeviceGroupInputSchema,
  deviceGroupNotificationDataSchema,
  ERROR_CODES,
  handleWaDeviceGroupJoinRequestsInputSchema,
  messageResponseSchema,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  parseWaGroupInviteCode,
  realtimeEventSchemas,
  REALTIME_EVENT,
  removeWaGroupParticipantsInputSchema,
  sendMessageSchema,
  updateWaDeviceGroupInputSchema,
  waDeviceGroupJoinInputSchema,
  waDeviceGroupJoinPreviewInputSchema,
  waDeviceGroupListQuerySchema,
  waDeviceGroupListSchema,
  waDeviceGroupMembersQuerySchema,
  waDeviceGroupSchema,
  waDeviceGroupsStateSchema,
  waGroupParticipantResultsSchema,
  waGroupParticipantsInputSchema,
  WA_GROUP_ERROR_CODES,
  WA_DEVICE_GROUP_EVENTS,
} from '@crm/contracts';

const uuid = '3f0f2b0e-7a53-4d2a-9d0c-5a4a7a6b1c11';
const code = 'AbCdEf1234567890abcdef';

const group = {
  id: uuid,
  deviceId: uuid,
  groupId: '120363000000000001',
  subject: 'Team',
  description: null,
  size: 3,
  isAdmin: true,
  announce: false,
  restrict: false,
  joinApproval: true,
  memberAddMode: 'all_member_add',
  hasInviteLink: true,
  pictureUrl: null,
  participantsPreview: [{ name: 'Asha', admin: null }],
  participantsCount: 3,
  pendingRequestCount: 1,
  conversationId: null,
  groupCreatedAt: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  syncedAt: null,
  left: false,
  leftAt: null,
  rowVersion: 1,
};

describe('limits and inputs', () => {
  it('create: subject up to 60, description up to 512, 1 to 20 E.164 numbers, risk acknowledged', () => {
    const ok = {
      deviceId: uuid,
      subject: '  Team  ',
      numbers: ['+919000000002'],
      acknowledgeRisk: true,
    };
    expect(createWaDeviceGroupInputSchema.parse(ok).subject).toBe('Team');
    const bad = (over: object) =>
      createWaDeviceGroupInputSchema.safeParse({ ...ok, ...over }).success;
    expect(bad({ subject: 'x'.repeat(61) })).toBe(false);
    expect(bad({ subject: '   ' })).toBe(false);
    expect(bad({ description: 'x'.repeat(513) })).toBe(false);
    expect(bad({ description: 'x'.repeat(512) })).toBe(true);
    expect(bad({ numbers: [] })).toBe(false);
    expect(bad({ numbers: Array.from({ length: 21 }, (_, i) => `+9190000000${10 + i}`) })).toBe(
      false,
    );
    expect(bad({ numbers: ['9190000000'] })).toBe(false);
    expect(bad({ acknowledgeRisk: false })).toBe(false);
  });

  it('participants: at most 20 numbers a call, remove too; numbers are E.164', () => {
    const nums = (n: number) => Array.from({ length: n }, (_, i) => `+91900000${String(1000 + i)}`);
    expect(waGroupParticipantsInputSchema.safeParse({ numbers: nums(20) }).success).toBe(true);
    expect(waGroupParticipantsInputSchema.safeParse({ numbers: nums(21) }).success).toBe(false);
    expect(removeWaGroupParticipantsInputSchema.safeParse({ numbers: nums(21) }).success).toBe(
      false,
    );
    expect(waGroupParticipantsInputSchema.safeParse({ numbers: ['nope'] }).success).toBe(false);
    expect(waGroupParticipantsInputSchema.safeParse({ numbers: [] }).success).toBe(false);
  });

  it('update: at least one field, the closed member-add set', () => {
    expect(updateWaDeviceGroupInputSchema.safeParse({}).success).toBe(false);
    expect(updateWaDeviceGroupInputSchema.safeParse({ announce: false }).success).toBe(true);
    expect(updateWaDeviceGroupInputSchema.safeParse({ memberAddMode: 'admin_add' }).success).toBe(
      true,
    );
    expect(updateWaDeviceGroupInputSchema.safeParse({ memberAddMode: 'nobody' }).success).toBe(
      false,
    );
    expect(updateWaDeviceGroupInputSchema.safeParse({ subject: 'x'.repeat(61) }).success).toBe(
      false,
    );
  });

  it('join requests: approve or reject up to 50 ids', () => {
    const ok = { action: 'approve', jids: ['777@lid'] };
    expect(handleWaDeviceGroupJoinRequestsInputSchema.safeParse(ok).success).toBe(true);
    expect(
      handleWaDeviceGroupJoinRequestsInputSchema.safeParse({ ...ok, action: 'ban' }).success,
    ).toBe(false);
    expect(handleWaDeviceGroupJoinRequestsInputSchema.safeParse({ ...ok, jids: [] }).success).toBe(
      false,
    );
    expect(
      handleWaDeviceGroupJoinRequestsInputSchema.safeParse({ ...ok, jids: Array(51).fill('a') })
        .success,
    ).toBe(false);
  });

  it('list query: keyset, needs the device, bounded', () => {
    expect(waDeviceGroupListQuerySchema.parse({ deviceId: uuid })).toMatchObject({
      limit: 25,
      status: 'all',
    });
    expect(waDeviceGroupListQuerySchema.safeParse({}).success).toBe(false);
    expect(waDeviceGroupListQuerySchema.safeParse({ deviceId: uuid, limit: '500' }).success).toBe(
      false,
    );
    expect(waDeviceGroupMembersQuerySchema.parse({}).limit).toBe(50);
  });
});

describe('invite links', () => {
  it('a link or a bare code parses to the code; anything else is refused', () => {
    expect(parseWaGroupInviteCode(`https://chat.whatsapp.com/${code}`)).toBe(code);
    expect(parseWaGroupInviteCode(`chat.whatsapp.com/invite/${code}`)).toBe(code);
    expect(parseWaGroupInviteCode(code)).toBe(code);
    expect(parseWaGroupInviteCode('https://evil.example/' + code)).toBeNull();
    expect(parseWaGroupInviteCode('a b c')).toBeNull();
  });
  it('join and preview inputs output the bare code; join needs the risk acknowledgement', () => {
    expect(
      waDeviceGroupJoinPreviewInputSchema.parse({
        deviceId: uuid,
        invite: `https://chat.whatsapp.com/${code}`,
      }).invite,
    ).toBe(code);
    expect(
      waDeviceGroupJoinPreviewInputSchema.safeParse({ deviceId: uuid, invite: 'nope' }).success,
    ).toBe(false);
    expect(waDeviceGroupJoinInputSchema.safeParse({ deviceId: uuid, invite: code }).success).toBe(
      false,
    );
    expect(
      waDeviceGroupJoinInputSchema.parse({ deviceId: uuid, invite: code, acknowledgeRisk: true })
        .invite,
    ).toBe(code);
  });
});

describe('responses', () => {
  it('a group row carries no invite code and no member numbers', () => {
    const parsed = waDeviceGroupSchema.parse({
      ...group,
      inviteCode: code,
      participantsPreview: [{ name: 'A', admin: null, phone: '+91' }],
    });
    expect(JSON.stringify(parsed)).not.toContain(code);
    expect(parsed.participantsPreview[0]).toEqual({ name: 'A', admin: null });
  });
  it('the list envelope and the state parse', () => {
    expect(
      waDeviceGroupListSchema.safeParse({
        items: [group],
        stats: { groups: 1, members: 3, joinRequests: 1, admin: 1, left: 0 },
        page: { nextCursor: null, hasMore: false, limit: 25 },
      }).success,
    ).toBe(true);
    const counter = { limit: 5, remaining: 3, resetsAt: null };
    expect(
      waDeviceGroupsStateSchema.safeParse({
        deviceId: uuid,
        connected: true,
        reason: 'ready',
        limits: {
          opsPerMinute: counter,
          opsPerDay: counter,
          createsPerDay: counter,
          joinByLinkPerDay: counter,
          cooldownUntil: null,
          participantsPerCall: 20,
        },
        joinByLinkEnabled: false,
        lastSyncedAt: null,
      }).success,
    ).toBe(true);
  });
  it('a participants answer lists an outcome per number', () => {
    expect(
      waGroupParticipantResultsSchema.safeParse({
        okCount: 1,
        failCount: 1,
        results: [
          { number: '+919000000002', outcome: 'ok', code: '200' },
          { number: '+919000000003', outcome: 'privacy_blocked', code: '403' },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('registry, events, notifications, messages', () => {
  it('every WA_GROUP_* code is in the shared ERROR_CODES, unique', () => {
    for (const c of Object.values(WA_GROUP_ERROR_CODES)) expect(ERROR_CODES[c]).toBe(c);
    for (const c of [
      'NOT_ADMIN',
      'NOT_FOUND',
      'DEVICE_NOT_READY',
      'RATE_LIMITED',
      'LIMIT_REACHED',
      'LEFT',
      'INVALID_NUMBER',
      'JOIN_LINK_INVALID',
      'UNAVAILABLE',
    ]) {
      expect(WA_GROUP_ERROR_CODES).toHaveProperty(`WA_GROUP_${c}`);
    }
  });
  it('outbox event names follow whatsapp.device_group.*', () => {
    expect(Object.values(WA_DEVICE_GROUP_EVENTS).sort()).toEqual([
      'whatsapp.device_group.created',
      'whatsapp.device_group.join_request',
      'whatsapp.device_group.left',
      'whatsapp.device_group.participants_changed',
      'whatsapp.device_group.updated',
    ]);
  });
  it('the realtime event is a signal: ids and the kind only', () => {
    expect(REALTIME_EVENT.deviceGroupChanged).toBe('whatsapp.device_group.changed');
    const s = realtimeEventSchemas[REALTIME_EVENT.deviceGroupChanged];
    expect(s.safeParse({ groupId: uuid, deviceId: uuid, kind: 'join_request' }).success).toBe(true);
    expect(s.safeParse({ groupId: uuid, deviceId: uuid, kind: 'deleted' }).success).toBe(false);
  });
  it('the two notification types exist with quiet defaults and a group', () => {
    for (const t of ['device_group_join_request', 'device_group_removed'] as const) {
      expect(NOTIFICATION_TYPES).toContain(t);
      expect(NOTIFICATION_CATALOG[t]).toEqual({
        group: 'whatsapp_groups',
        toast: true,
        sound: false,
        push: false,
      });
    }
    expect(deviceGroupNotificationDataSchema.safeParse({ groupId: uuid, count: 2 }).success).toBe(
      true,
    );
  });
  it('a text send into a group may carry mentions; other kinds are unchanged', () => {
    const base = { clientMessageId: uuid, kind: 'text', body: 'hi @Asha' };
    expect(
      sendMessageSchema.parse({
        ...base,
        mentions: [{ jid: '919000000002@s.whatsapp.net', name: 'Asha' }],
      }),
    ).toMatchObject({ mentions: [{ jid: '919000000002@s.whatsapp.net' }] });
    expect(sendMessageSchema.safeParse(base).success).toBe(true);
    expect(
      sendMessageSchema.safeParse({ ...base, mentions: Array(51).fill({ jid: 'a@lid' }) }).success,
    ).toBe(false);
  });
  it('a message row may name its mentions and the speaker', () => {
    expect(messageResponseSchema.shape.mentions).toBeDefined();
    expect(messageResponseSchema.shape.group).toBeDefined();
  });
});
