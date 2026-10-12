import { describe, expect, it } from 'vitest';
import {
  matchesMember,
  toDeviceGroupDto,
  toJoinRequestDto,
  toMemberDto,
} from '../../../src/modules/whatsapp-devices-baileys/device-groups.mapper';
import type { DeviceGroupRow } from '../../../src/modules/whatsapp-devices-baileys/device-groups.repository';

const row = (over: Partial<DeviceGroupRow> = {}): DeviceGroupRow => ({
  id: 7,
  uuid: '3f0f2b0e-7a53-4d2a-9d0c-5a4a7a6b1c11',
  device_id: 3,
  device_uuid: '5a1f2b0e-7a53-4d2a-9d0c-5a4a7a6b1c22',
  group_jid: '120363000000000001',
  subject: 'Team',
  description: 'About',
  size: 3,
  is_admin: true,
  announce: false,
  restrict_info: true,
  join_approval: false,
  member_add_mode: 'admin_add',
  owner_jid: '919000000001@s.whatsapp.net',
  has_invite: true,
  picture_url: null,
  creation_at: new Date('2026-01-01T00:00:00Z'),
  synced_at: new Date('2026-01-02T00:00:00Z'),
  left_at: null,
  participants: [
    {
      jid: '919000000001@s.whatsapp.net',
      phone: '919000000001',
      lid: null,
      name: 'Me',
      admin: 'superadmin',
    },
    {
      jid: '919000000002@s.whatsapp.net',
      phone: '919000000002',
      lid: null,
      name: 'Asha',
      admin: null,
    },
    { jid: '55@lid', phone: null, lid: '55', name: 'Anon', admin: null },
  ],
  join_requests: [
    {
      jid: '919000000009@s.whatsapp.net',
      phone: '919000000009',
      lid: null,
      name: null,
      requestedAt: null,
    },
  ],
  created_at: new Date('2026-01-01T00:00:00Z'),
  created_at_iso: '2026-01-01T00:00:00.000000Z',
  row_version: 4,
  conversation_uuid: null,
  ...over,
});

describe('the group on the wire', () => {
  it('carries no invite code, no member number and no join request number', () => {
    const dto = toDeviceGroupDto(row());
    const text = JSON.stringify(dto);
    expect(text).not.toMatch(/9190000000|@s\.whatsapp\.net|@lid|invite_code/);
    expect(dto.hasInviteLink).toBe(true);
    expect(dto.pendingRequestCount).toBe(1);
    expect(dto.participantsPreview).toEqual([
      { name: 'Me', admin: 'superadmin' },
      { name: 'Asha', admin: null },
      { name: 'Anon', admin: null },
    ]);
    expect(dto.memberAddMode).toBe('admin_add');
    expect(dto.restrict).toBe(true);
    expect(dto.deviceId).toBe('5a1f2b0e-7a53-4d2a-9d0c-5a4a7a6b1c22');
  });

  it('a group the number left is read-only: not admin, no link, left with its time', () => {
    const dto = toDeviceGroupDto(row({ left_at: new Date('2026-02-01T00:00:00Z') }));
    expect(dto.left).toBe(true);
    expect(dto.isAdmin).toBe(false);
    expect(dto.hasInviteLink).toBe(false);
    expect(dto.leftAt).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('members and requests (manage only)', () => {
  it('E.164 phones, the self flag, and no phone for an anonymous member', () => {
    const [me, asha, anon] = row().participants.map((p) => toMemberDto(p, '919000000001'));
    expect(me).toMatchObject({ phone: '+919000000001', self: true, admin: 'superadmin' });
    expect(asha).toMatchObject({ phone: '+919000000002', self: false });
    expect(anon).toMatchObject({ phone: null, jid: '55@lid', self: false });
  });

  it('searches by name or by digits typed with or without the plus', () => {
    const [me, asha, anon] = row().participants;
    expect(matchesMember(asha!, 'ash')).toBe(true);
    expect(matchesMember(asha!, '+91900000000')).toBe(true);
    expect(matchesMember(me!, 'ash')).toBe(false);
    expect(matchesMember(anon!, '55')).toBe(false);
    expect(matchesMember(me!, undefined)).toBe(true);
  });

  it('a request keeps its id for approve and reject', () => {
    expect(toJoinRequestDto(row().join_requests[0]!)).toEqual({
      jid: '919000000009@s.whatsapp.net',
      phone: '+919000000009',
      name: null,
      requestedAt: null,
    });
  });
});
