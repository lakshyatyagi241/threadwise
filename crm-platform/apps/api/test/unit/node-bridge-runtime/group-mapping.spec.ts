import { describe, expect, it } from 'vitest';
import { parseWaGroupInviteCode } from '@crm/contracts';
import {
  bareGroupId,
  classifyGroupError,
  COOLDOWN_REASONS,
  includesSelf,
  inviteCodeOf,
  looksLikeGroupId,
  mentionToken,
  participantOutcome,
  toGroupJid,
  toSnapshot,
  type RawGroupMetadata,
} from '../../../src/infra/providers/node-bridge-runtime/group-mapping';

const self = { jid: '919000000001@s.whatsapp.net', lid: '555000111@lid' };

const meta = (over: Partial<RawGroupMetadata> = {}): RawGroupMetadata => ({
  id: '120363000000000001@g.us',
  addressingMode: 'pn',
  subject: 'Team',
  desc: 'About',
  creation: 1_767_225_600,
  size: 3,
  announce: true,
  restrict: false,
  memberAddMode: false,
  joinApprovalMode: true,
  ownerJid: '919000000001@s.whatsapp.net',
  participants: [
    { id: '919000000001@s.whatsapp.net', admin: 'superadmin' },
    { id: '919000000002@s.whatsapp.net', admin: null, notify: 'Asha' },
    {
      id: '777@lid',
      jid: '919000000003@s.whatsapp.net',
      lid: '777@lid',
      admin: 'admin',
      name: 'Ravi',
    },
  ],
  ...over,
});

describe('toSnapshot', () => {
  it('maps the metadata: bare id, settings, creation, roster with roles', () => {
    const g = toSnapshot(meta(), self);
    expect(g).toMatchObject({
      jid: '120363000000000001@g.us',
      groupId: '120363000000000001',
      subject: 'Team',
      description: 'About',
      size: 3,
      announce: true,
      restrict: false,
      joinApproval: true,
      memberAddMode: 'admin_add',
      addressingMode: 'pn',
      inviteCode: null,
      creation: '2026-01-01T00:00:00.000Z',
      isAdmin: true,
    });
    expect(g.participants).toEqual([
      {
        jid: '919000000001@s.whatsapp.net',
        phone: '919000000001',
        lid: null,
        name: null,
        admin: 'superadmin',
      },
      {
        jid: '919000000002@s.whatsapp.net',
        phone: '919000000002',
        lid: null,
        name: 'Asha',
        admin: null,
      },
      { jid: '777@lid', phone: '919000000003', lid: '777', name: 'Ravi', admin: 'admin' },
    ]);
  });

  it('our own admin flag: a plain member is not admin, an admin is, whichever id the group uses for us', () => {
    const plain = toSnapshot(meta({ participants: [{ id: '919000000001@s.whatsapp.net' }] }), self);
    expect(plain.isAdmin).toBe(false);
    const byLid = toSnapshot(
      meta({ participants: [{ id: '555000111@lid', lid: '555000111@lid', admin: 'admin' }] }),
      self,
    );
    expect(byLid.isAdmin).toBe(true);
    // a device suffix on our id does not matter
    expect(toSnapshot(meta(), { jid: '919000000001@s.whatsapp.net', lid: null }).isAdmin).toBe(
      true,
    );
  });

  it('defaults: member add on for everyone when WhatsApp does not say otherwise, a missing creation is null, the roster is capped', () => {
    const g = toSnapshot(
      meta({
        memberAddMode: undefined,
        creation: undefined,
        announce: undefined,
        joinApprovalMode: undefined,
        participants: Array.from({ length: 1100 }, (_, i) => ({
          id: `${9100 + i}@s.whatsapp.net`,
        })),
        size: 1100,
      }),
      self,
    );
    expect(g.memberAddMode).toBe('all_member_add');
    expect(g.creation).toBeNull();
    expect(g.announce).toBe(false);
    expect(g.joinApproval).toBe(false);
    expect(g.size).toBe(1100);
    expect(g.participants).toHaveLength(1024);
  });

  it('keeps an invite code only when WhatsApp sent one', () => {
    expect(toSnapshot(meta({ inviteCode: 'AbCdEf1234567890abcdef' }), self).inviteCode).toBe(
      'AbCdEf1234567890abcdef',
    );
  });
});

describe('ids', () => {
  it('the bare group id and back', () => {
    expect(bareGroupId('120363@g.us')).toBe('120363');
    expect(bareGroupId('120363')).toBe('120363');
    expect(toGroupJid('120363')).toBe('120363@g.us');
    expect(toGroupJid('120363@g.us')).toBe('120363@g.us');
    expect(toGroupJid('1234-5678')).toBe('1234-5678@g.us');
  });
  it('a bare group id is never taken for a phone number', () => {
    expect(looksLikeGroupId('120363000000000001')).toBe(true);
    expect(looksLikeGroupId('1234567890-1600000000')).toBe(true);
    expect(looksLikeGroupId('120363000000000001@g.us')).toBe(true);
    expect(looksLikeGroupId('919800000001')).toBe(false);
    expect(looksLikeGroupId('+91 98000 00001')).toBe(false);
    expect(looksLikeGroupId('919800000001@s.whatsapp.net')).toBe(false);
  });
  it('a mention token is @ plus the user part of the id', () => {
    expect(mentionToken('919000000002@s.whatsapp.net')).toBe('@919000000002');
    expect(mentionToken('777@lid')).toBe('@777');
    expect(mentionToken('919000000002:4@s.whatsapp.net')).toBe('@919000000002');
  });
  it('recognises our own number among the ids of an event', () => {
    expect(includesSelf(['919000000009@s.whatsapp.net', '919000000001@s.whatsapp.net'], self)).toBe(
      true,
    );
    expect(includesSelf(['555000111@lid'], self)).toBe(true);
    expect(includesSelf(['919000000009@s.whatsapp.net'], self)).toBe(false);
  });
});

describe('participantOutcome', () => {
  it('200 is done whatever the action', () => {
    for (const c of ['add', 'remove', 'promote', 'demote'] as const) {
      expect(participantOutcome(c, '200')).toBe('ok');
    }
  });
  it('an add: privacy, not on WhatsApp, already in, group full', () => {
    expect(participantOutcome('add', '403')).toBe('privacy_blocked');
    expect(participantOutcome('add', '404')).toBe('not_on_whatsapp');
    expect(participantOutcome('add', '409')).toBe('already_member');
    expect(participantOutcome('add', '419')).toBe('group_full');
    expect(participantOutcome('add', '500')).toBe('failed');
  });
  it('the other actions: not allowed, not in the group', () => {
    expect(participantOutcome('remove', '403')).toBe('not_allowed');
    expect(participantOutcome('remove', '404')).toBe('not_member');
    expect(participantOutcome('demote', '409')).toBe('not_member');
    expect(participantOutcome('promote', '408')).toBe('failed');
  });
});

const boom = (message: string, data?: number) =>
  Object.assign(new Error(message), { isBoom: true, data });

describe('classifyGroupError', () => {
  it('reads the text and the code WhatsApp refused with', () => {
    expect(classifyGroupError(boom('rate-overlimit', 429))).toBe('whatsapp_rate_limited');
    expect(classifyGroupError(boom('Unknown error', 429))).toBe('whatsapp_rate_limited');
    expect(classifyGroupError(boom('forbidden', 403))).toBe('forbidden');
    expect(classifyGroupError(boom('not-authorized', 401))).toBe('not_admin');
    expect(classifyGroupError(boom('not-allowed', 403))).toBe('not_admin');
    expect(classifyGroupError(boom('item-not-found', 404))).toBe('not_found');
    expect(classifyGroupError(boom('resource-limit', 419))).toBe('limit_reached');
    expect(classifyGroupError(new Error('something else'))).toBe('unknown');
  });
  it('an invite that is gone or malformed is a bad invite, not a missing group', () => {
    expect(classifyGroupError(boom('gone', 410), true)).toBe('bad_invite');
    expect(classifyGroupError(boom('item-not-found', 404), true)).toBe('bad_invite');
    expect(classifyGroupError(boom('invalid invite code', 400), true)).toBe('bad_invite');
    expect(classifyGroupError(boom('gone', 410), false)).toBe('not_found');
  });
  it('only a limit or ban signal starts the cooldown, never a plain "not admin"', () => {
    expect(COOLDOWN_REASONS.has('forbidden')).toBe(true);
    expect(COOLDOWN_REASONS.has('whatsapp_rate_limited')).toBe(true);
    expect(COOLDOWN_REASONS.has('not_admin')).toBe(false);
    expect(COOLDOWN_REASONS.has('not_found')).toBe(false);
    expect(COOLDOWN_REASONS.has('limit_reached')).toBe(false);
  });
});

describe('invite codes', () => {
  const code = 'AbCdEf1234567890abcdef';
  it('takes a link or a bare code and nothing else', () => {
    expect(inviteCodeOf(`https://chat.whatsapp.com/${code}`)).toBe(code);
    expect(inviteCodeOf(`  chat.whatsapp.com/${code}?mode=r_t `)).toBe(code);
    expect(inviteCodeOf(code)).toBe(code);
    expect(inviteCodeOf('https://example.com/abc')).toBeNull();
    expect(inviteCodeOf('short')).toBeNull();
    expect(inviteCodeOf('')).toBeNull();
  });
  it('agrees with the contract parser', () => {
    for (const v of [
      `https://chat.whatsapp.com/${code}`,
      code,
      'nope',
      'https://x.io/aaaaaaaaaaaa',
    ]) {
      expect(inviteCodeOf(v)).toBe(parseWaGroupInviteCode(v));
    }
  });
});
