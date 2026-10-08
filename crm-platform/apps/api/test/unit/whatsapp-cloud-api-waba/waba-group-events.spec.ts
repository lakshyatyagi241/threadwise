import { describe, expect, it } from 'vitest';
import {
  changedKinds,
  GROUP_EVENTS,
  groupEventsFor,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-group-events';
import {
  EMPTY_GROUP,
  type GroupFacts,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-group-rules';
import {
  pendingOf,
  toGroupDto,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-groups.mapper';
import type { WabaGroupRow } from '../../../src/modules/whatsapp-cloud-api-waba/waba-groups.repository';

const facts = (over: Partial<GroupFacts> = {}): GroupFacts => ({ ...EMPTY_GROUP, ...over });
const types = (b: GroupFacts | null, a: GroupFacts | null) =>
  groupEventsFor('action', b, a).map((e) => e.type);

describe('whatsapp.group.* events', () => {
  it('a row that appears is created, whoever made it', () => {
    expect(types(null, facts({ subject: 'VIP' }))).toEqual([GROUP_EVENTS.created]);
  });

  it('a visible change is updated and names what moved; a redelivered webhook announces nothing', () => {
    const before = facts({ subject: 'VIP' });
    const after = facts({ subject: 'VIP club', inviteLink: 'https://chat.whatsapp.com/x' });
    expect(groupEventsFor('group_settings_update', before, after)).toEqual([
      { type: GROUP_EVENTS.updated, extra: { changed: ['subject', 'invite_link'] } },
    ]);
    expect(changedKinds(after, after)).toEqual([]);
    expect(types(after, after)).toEqual([]);
  });

  it('a deleted row is deleted; nothing to delete announces nothing', () => {
    expect(types(facts({ subject: 'x' }), null)).toEqual([GROUP_EVENTS.deleted]);
    expect(types(null, null)).toEqual([]);
  });

  it('the suspended flag flipping is announced both ways', () => {
    const on = groupEventsFor('group_status_update', facts(), facts({ suspended: true }));
    expect(on).toEqual([{ type: GROUP_EVENTS.suspended, extra: { suspended: true } }]);
    const off = groupEventsFor('group_status_update', facts({ suspended: true }), facts());
    expect(off).toEqual([{ type: GROUP_EVENTS.suspended, extra: { suspended: false } }]);
  });

  it('a join request entering the queue and one revoked are join_request events with the count, never a number', () => {
    const queued = facts({ meta: { join_requests: { r1: { wa_id: '911', created_at: '1' } } } });
    const entered = groupEventsFor('group_participants_update', facts(), queued);
    expect(entered).toEqual([
      { type: GROUP_EVENTS.joinRequest, extra: { handled: null, count: 1, pending: 1 } },
    ]);
    expect(JSON.stringify(entered)).not.toContain('911');
    const revoked = groupEventsFor('group_participants_update', queued, facts());
    expect(revoked[0]).toEqual({
      type: GROUP_EVENTS.joinRequest,
      extra: { handled: 'revoked', count: 1, pending: 0 },
    });
  });
});

describe('the group wire shape', () => {
  const row = (meta: Record<string, unknown> | null): WabaGroupRow => ({
    id: 9,
    uuid: '11111111-1111-4111-8111-111111111111',
    provider_config_id: 3,
    group_id: 'G',
    subject: null,
    description: null,
    invite_link: null,
    join_approval_mode: 'approval_required',
    participant_count: 2,
    suspended: false,
    creation_timestamp: null,
    synced_at: null,
    meta_json: meta,
    created_at: new Date('2026-10-08T00:00:00Z'),
    created_at_iso: '2026-10-08T00:00:00.000000Z',
    row_version: 1,
  });

  it('exposes the uuid, never the internal ids, and says the link is awaited when there is none', () => {
    const dto = toGroupDto(row(null), false);
    expect(dto.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(dto)).not.toContain('provider_config_id');
    expect(dto.awaitingInviteLink).toBe(true);
    expect(dto.joinApprovalMode).toBe('approval_required');
  });

  it('hides the numbers of people waiting from a caller who cannot manage, but keeps the count', () => {
    const meta = { join_requests: { r1: { wa_id: '911', created_at: '5' }, r2: { wa_id: '922' } } };
    const reader = toGroupDto(row(meta), false);
    expect(reader.pendingJoinRequestCount).toBe(2);
    expect(reader.pendingJoinRequests).toEqual([]);
    expect(JSON.stringify(reader)).not.toContain('911');
    const manager = toGroupDto(row(meta), true);
    expect(manager.pendingJoinRequests).toEqual([
      { id: 'r1', waId: '911', createdAt: '5' },
      { id: 'r2', waId: '922', createdAt: null },
    ]);
  });

  it('treats a legacy empty array (PHP) or garbage as an empty queue', () => {
    expect(pendingOf({ join_requests: [] })).toEqual([]);
    expect(pendingOf({ join_requests: 'x' })).toEqual([]);
    expect(pendingOf(null)).toEqual([]);
  });

  it('reads the creation error Meta reported', () => {
    expect(
      toGroupDto(row({ last_error: { code: 131211, message: 'limit' } }), false).lastError,
    ).toEqual({
      code: 131211,
      message: 'limit',
    });
  });
});
