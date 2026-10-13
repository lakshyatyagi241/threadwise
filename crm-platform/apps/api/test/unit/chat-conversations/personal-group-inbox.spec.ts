import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import {
  isPersonalGroupSendKind,
  personalGroupSendBlock,
} from '../../../src/infra/providers/whatsapp/group-peer';
import { InboundMessageHooks } from '../../../src/modules/chat-conversations/inbound-hooks';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';
import { PersonalGroupThreadReader } from '../../../src/modules/chat-conversations/personal-group-thread.reader';
import {
  defaultTitle,
  identityOfPeer,
  normalizePeerKey,
} from '../../../src/modules/chat-conversations/peer-key';
import { mentionedBody } from '../../../src/modules/node-bridge-runtime/inbox/qr-channel.adapter';

/** Groups on a personal number in the inbox: the pure rules (keys, send guard, mention body, hooks). The pipeline is in the e2e. */
describe('a g: thread key never goes through the phone canonicaliser', () => {
  it.each(['whatsapp_qr', 'whatsapp_cloud', 'simulator'])(
    '%s keeps the group id as given',
    (kind) => {
      expect(normalizePeerKey(kind, 'g:120363111111111111')).toBe('g:120363111111111111');
      expect(normalizePeerKey(kind, '  g:AbC-123  ')).toBe('g:AbC-123');
      expect(normalizePeerKey(kind, 'g:')).toBeNull();
      expect(normalizePeerKey(kind, 'g:' + 'x'.repeat(200))).toBeNull();
    },
  );

  it('a group has no contact identity and a readable default title', () => {
    expect(identityOfPeer('whatsapp_qr', 'g:120363111111111111')).toBeNull();
    expect(defaultTitle('whatsapp_qr', 'g:120363111111111111', null)).toBe('WhatsApp group');
    expect(defaultTitle('whatsapp_qr', '919800000001', null)).toBe('+919800000001');
  });
});

describe('what a personal number may send into a group', () => {
  it.each(['text', 'media', 'location', 'contacts', 'reaction'])('%s is allowed', (k) =>
    expect(isPersonalGroupSendKind(k)).toBe(true),
  );
  it.each(['template', 'interactive'])('%s is not', (k) =>
    expect(isPersonalGroupSendKind(k)).toBe(false),
  );

  it('left wins over announce-only; announce-only only blocks a non-admin; an unknown group is not blocked', () => {
    expect(personalGroupSendBlock(undefined)).toBeNull();
    expect(personalGroupSendBlock({ leftAt: null, announce: false, isAdmin: false })).toBeNull();
    expect(personalGroupSendBlock({ leftAt: null, announce: true, isAdmin: true })).toBeNull();
    expect(personalGroupSendBlock({ leftAt: null, announce: true, isAdmin: false })?.code).toBe(
      'WA_GROUP_ANNOUNCE_ONLY',
    );
    expect(
      personalGroupSendBlock({ leftAt: '2026-10-01T00:00:00Z', announce: true, isAdmin: false })
        ?.code,
    ).toBe('WA_GROUP_LEFT');
  });
});

describe('OutboundService.assertGroupSendable for a personal number', () => {
  const qr = { kind: 'whatsapp_qr', externalId: '5b1f2d2e-0000-4000-8000-000000000001' } as never;
  function build(row: Record<string, unknown> | undefined) {
    const wallet = vi.fn(async () => undefined);
    const svc = new OutboundService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assertCanLaunch: wallet } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const tx = { execute: vi.fn(async () => ({ rows: row ? [row] : [] })) };
    const run = () =>
      (
        svc as unknown as { assertGroupSendable: (...a: unknown[]) => Promise<void> }
      ).assertGroupSendable(tx, 7, qr, 'g:120363111111111111');
    return { run, wallet };
  }

  it('lets a writable group through and never asks the wallet (one send is one message)', async () => {
    const { run, wallet } = build({ left_at: null, announce: false, is_admin: false });
    await run();
    expect(wallet).not.toHaveBeenCalled();
  });

  it('refuses a left group with 409 WA_GROUP_LEFT and an announce-only one with 422 WA_GROUP_ANNOUNCE_ONLY', async () => {
    const left = (await build({ left_at: new Date(), announce: false, is_admin: true })
      .run()
      .catch((e: unknown) => e)) as AppError;
    expect([left.code, left.getStatus()]).toEqual(['WA_GROUP_LEFT', 409]);
    const announce = (await build({ left_at: null, announce: true, is_admin: false })
      .run()
      .catch((e: unknown) => e)) as AppError;
    expect([announce.code, announce.getStatus()]).toEqual(['WA_GROUP_ANNOUNCE_ONLY', 422]);
  });

  it('a group the directory has not read yet is not refused', async () => {
    await expect(build(undefined).run()).resolves.toBeNull();
  });
});

describe('the body of a mention', () => {
  const jid = '919000000002@s.whatsapp.net';
  it('swaps the typed name for the id WhatsApp draws the tag from', () => {
    expect(mentionedBody('Hi @Ravi we have it', [{ jid, name: 'Ravi' }])).toBe(
      'Hi @919000000002 we have it',
    );
  });
  it('leaves a body that already has the token, or a mention with no name, alone', () => {
    expect(mentionedBody('Hi @919000000002', [{ jid, name: 'Ravi' }])).toBe('Hi @919000000002');
    expect(mentionedBody('Hi all', [{ jid }])).toBe('Hi all');
  });
});

describe('no listener runs on a group message', () => {
  it('InboundMessageHooks answers a g: thread as consumed without calling any listener', async () => {
    const hooks = new InboundMessageHooks();
    const onStored = vi.fn(async () => undefined);
    hooks.register({ name: 'would-reply', onStored });
    hooks.register({ name: 'late', after: true, onStored });
    const r = await hooks.run({
      orgId: 1,
      peerKey: 'g:120363111111111111',
      channelKind: 'whatsapp_qr',
    } as never);
    expect(r).toEqual({ consumed: true });
    expect(onStored).not.toHaveBeenCalled();
    // A person's thread still reaches them.
    await hooks.run({ orgId: 1, peerKey: '919800000001', channelKind: 'whatsapp_qr' } as never);
    expect(onStored).toHaveBeenCalledTimes(2);
  });
});

describe('PersonalGroupThreadReader', () => {
  const participants = [
    { jid: 'a@s.whatsapp.net', phone: '919000000001', lid: null, name: 'Asha', admin: 'admin' },
    { jid: 'b@s.whatsapp.net', phone: '919000000002', lid: null, name: 'Ravi', admin: null },
    { jid: '555@lid', phone: null, lid: '555', name: null, admin: null },
  ];
  const tx = (row: Record<string, unknown> | undefined) =>
    ({ execute: vi.fn(async () => ({ rows: row ? [row] : [] })) }) as never;
  const reader = new PersonalGroupThreadReader();
  const ch = { id: 3, kind: 'whatsapp_qr' };

  it('is null for any thread that is not a personal group', async () => {
    expect(
      await reader.stateOf(tx(undefined), 1, { id: 3, kind: 'whatsapp_cloud' }, 'g:1'),
    ).toBeNull();
    expect(await reader.stateOf(tx(undefined), 1, ch, '919800000001')).toBeNull();
  });

  it('reports left, announce-only and who may write', async () => {
    const row = { left_at: null, announce: true, is_admin: false, size: 3, participants };
    expect(await reader.stateOf(tx(row), 1, ch, 'g:120')).toMatchObject({
      groupId: '120',
      announceOnly: true,
      canSend: false,
      left: false,
      memberCount: 3,
    });
    expect(
      await reader.stateOf(tx({ ...row, left_at: new Date(), announce: false }), 1, ch, 'g:120'),
    ).toMatchObject({ left: true, canSend: false });
    // No directory row yet: nothing is known against writing.
    expect(await reader.stateOf(tx(undefined), 1, ch, 'g:120')).toMatchObject({
      canSend: true,
      memberCount: 0,
    });
  });

  it('lists members admins first, filters by name or digits, and keeps a LID-only member', async () => {
    const row = { left_at: null, announce: false, is_admin: true, size: 3, participants };
    const all = await reader.members(tx(row), 1, ch, 'g:120', { limit: 50 });
    expect(all.total).toBe(3);
    expect(all.members.map((m) => m.jid)).toEqual([
      'a@s.whatsapp.net',
      'b@s.whatsapp.net',
      '555@lid',
    ]);
    expect(all.members[0]).toEqual({
      jid: 'a@s.whatsapp.net',
      name: 'Asha',
      phone: '+919000000001',
      admin: 'admin',
    });
    expect(all.members[2]!.phone).toBeNull();
    expect(
      (await reader.members(tx(row), 1, ch, 'g:120', { q: 'rav', limit: 50 })).members,
    ).toHaveLength(1);
    expect(
      (await reader.members(tx(row), 1, ch, 'g:120', { q: '0002', limit: 50 })).members[0]!.name,
    ).toBe('Ravi');
    expect((await reader.members(tx(row), 1, ch, 'g:120', { limit: 1 })).members).toHaveLength(1);
  });
});
