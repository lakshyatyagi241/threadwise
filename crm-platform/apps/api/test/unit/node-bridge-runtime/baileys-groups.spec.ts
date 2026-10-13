import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SocketEvent,
  WaSocket,
} from '../../../src/infra/providers/node-bridge-runtime/socket.port';

/** A fake Baileys socket: records the library calls the adapter makes and lets a test fire the events it listens to. */
const lib = vi.hoisted(() => ({ sock: null as unknown }));
vi.mock('baileys', () => ({
  default: () => lib.sock,
  BufferJSON: { reviver: undefined, replacer: undefined },
  Browsers: { macOS: () => ['Mac', 'Desktop', '1'] },
  downloadMediaMessage: async () => Buffer.from('file'),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 1] }),
  initAuthCreds: () => ({}),
  makeCacheableSignalKeyStore: (k: unknown) => k,
  proto: { Message: { AppStateSyncKeyData: { fromObject: (x: unknown) => x } } },
}));

import { BaileysSocketFactory } from '../../../src/infra/providers/node-bridge-runtime/baileys.socket-factory';

const ME = '919000000001:5@s.whatsapp.net';
const calls: Array<[string, ...unknown[]]> = [];
const rec =
  <T>(name: string, result: T) =>
  async (...args: unknown[]): Promise<T> => {
    calls.push([name, ...args]);
    return result;
  };

const metadata = (id = '120363000000000001@g.us') => ({
  id,
  subject: 'Team',
  addressingMode: 'pn',
  size: 2,
  participants: [
    { id: '919000000001@s.whatsapp.net', admin: 'superadmin' },
    { id: '919000000002@s.whatsapp.net' },
  ],
});

function makeSock() {
  const ev = new EventEmitter();
  return {
    ev: Object.assign(ev, { removeAllListeners: ev.removeAllListeners.bind(ev) }),
    user: { id: ME, lid: '555000111:5@lid' },
    sendMessage: async (...a: unknown[]) => {
      calls.push(['sendMessage', ...a]);
      return { key: { id: 'WAMID1' } };
    },
    groupFetchAllParticipating: rec('fetchAll', { a: metadata() }),
    groupMetadata: async (jid: string) => {
      calls.push(['groupMetadata', jid]);
      return metadata(jid);
    },
    groupCreate: async (subject: string, jids: string[]) => {
      calls.push(['groupCreate', subject, jids]);
      return metadata();
    },
    groupParticipantsUpdate: rec('participants', [
      { status: '200', jid: '919000000002@s.whatsapp.net' },
      { status: '403', jid: '919000000003@s.whatsapp.net' },
    ]),
    groupUpdateSubject: rec('subject', undefined),
    groupUpdateDescription: rec('description', undefined),
    groupSettingUpdate: rec('setting', undefined),
    groupMemberAddMode: rec('memberAddMode', undefined),
    groupJoinApprovalMode: rec('joinApproval', undefined),
    groupRequestParticipantsList: rec('requests', [
      { jid: '777@lid', phone_number: '919000000007@s.whatsapp.net', request_time: '1767225600' },
    ]),
    groupRequestParticipantsUpdate: rec('requestUpdate', [{ status: '200', jid: '777@lid' }]),
    groupLeave: rec('leave', undefined),
    groupInviteCode: rec('invite', 'CODE1234567890abcdef'),
    groupRevokeInvite: rec('revoke', 'NEWCODE1234567890abc'),
    groupGetInviteInfo: rec('inviteInfo', {
      ...metadata('120363000000000009@g.us'),
      joinApprovalMode: true,
    }),
    groupAcceptInvite: rec('accept', '120363000000000009@g.us'),
    updateProfilePicture: rec('picture', undefined),
    removeProfilePicture: rec('removePicture', undefined),
    updateMediaMessage: async () => undefined,
    end: () => undefined,
  };
}

async function open(): Promise<{
  socket: WaSocket;
  sock: ReturnType<typeof makeSock>;
  events: SocketEvent[];
}> {
  const sock = makeSock();
  lib.sock = sock;
  const store = {
    read: async () => null,
    readMany: async () => new Map(),
    write: async () => undefined,
  };
  const factory = new BaileysSocketFactory(store as never, {} as never);
  const socket = await factory.create({
    orgId: 1,
    deviceId: 2,
    phoneDigits: '919000000001',
    proxy: null,
  });
  const events: SocketEvent[] = [];
  socket.subscribe((e) => events.push(e));
  return { socket, sock, events };
}

beforeEach(() => {
  calls.length = 0;
  vi.useRealTimers();
});

describe('group actions on the Baileys adapter', () => {
  it('reads a group into the snapshot with our own admin flag, whatever device suffix our id carries', async () => {
    const { socket } = await open();
    const r = (await socket.groups({ type: 'metadata', groupJid: '120363000000000001' })) as {
      group: { groupId: string; isAdmin: boolean; jid: string };
    };
    expect(calls).toContainEqual(['groupMetadata', '120363000000000001@g.us']);
    expect(r.group).toMatchObject({
      groupId: '120363000000000001',
      jid: '120363000000000001@g.us',
      isAdmin: true,
    });
  });

  it('create sends numbers as chat ids, sets the description after, and says who was left out', async () => {
    const { socket } = await open();
    const r = await socket.groups({
      type: 'create',
      subject: 'Team',
      description: 'About us',
      participants: ['+91 90000 00002', '919000000009'],
    });
    expect(calls[0]).toEqual([
      'groupCreate',
      'Team',
      ['919000000002@s.whatsapp.net', '919000000009@s.whatsapp.net'],
    ]);
    expect(calls[1]).toEqual(['description', '120363000000000001@g.us', 'About us']);
    expect(r).toMatchObject({
      descriptionSet: true,
      participants: [
        { jid: '919000000002@s.whatsapp.net', status: '200' },
        { jid: '919000000009@s.whatsapp.net', status: '403' },
      ],
    });
  });

  it('participants return one status per person, as WhatsApp gave them', async () => {
    const { socket } = await open();
    const r = await socket.groups({
      type: 'participants',
      groupJid: '120363000000000001@g.us',
      participants: ['919000000002', '919000000003'],
      change: 'add',
    });
    expect(r).toEqual({
      participants: [
        { jid: '919000000002@s.whatsapp.net', status: '200' },
        { jid: '919000000003@s.whatsapp.net', status: '403' },
      ],
    });
    expect(calls[0]).toEqual([
      'participants',
      '120363000000000001@g.us',
      ['919000000002@s.whatsapp.net', '919000000003@s.whatsapp.net'],
      'add',
    ]);
  });

  it('settings: admin-only edit, member add mode and join approval each reach the library', async () => {
    const { socket } = await open();
    await socket.groups({ type: 'settings', groupJid: '1203', setting: 'locked' });
    await socket.groups({ type: 'member_add_mode', groupJid: '1203', mode: 'admin_add' });
    await socket.groups({ type: 'join_approval', groupJid: '1203', enabled: true });
    await socket.groups({ type: 'join_approval', groupJid: '1203', enabled: false });
    expect(calls).toEqual([
      ['setting', '1203@g.us', 'locked'],
      ['memberAddMode', '1203@g.us', 'admin_add'],
      ['joinApproval', '1203@g.us', 'on'],
      ['joinApproval', '1203@g.us', 'off'],
    ]);
  });

  it('join requests list with the person and the time, and approve returns a status each', async () => {
    const { socket } = await open();
    expect(await socket.groups({ type: 'join_requests', groupJid: '1203' })).toEqual({
      requests: [
        {
          jid: '777@lid',
          phone: '919000000007',
          lid: '777',
          name: null,
          requestedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(
      await socket.groups({
        type: 'join_request_update',
        groupJid: '1203',
        participants: ['777@lid'],
        action: 'approve',
      }),
    ).toEqual({ participants: [{ jid: '777@lid', status: '200' }] });
    expect(calls[1]).toEqual(['requestUpdate', '1203@g.us', ['777@lid'], 'approve']);
  });

  it('invite: read, revoke, preview and join by code or link', async () => {
    const { socket } = await open();
    expect(await socket.groups({ type: 'invite', groupJid: '1203' })).toEqual({
      code: 'CODE1234567890abcdef',
    });
    expect(await socket.groups({ type: 'revoke_invite', groupJid: '1203' })).toEqual({
      code: 'NEWCODE1234567890abc',
    });
    expect(
      await socket.groups({
        type: 'get_invite_info',
        code: 'https://chat.whatsapp.com/AbCdEf1234567890abcdef',
      }),
    ).toEqual({
      invite: {
        groupId: '120363000000000009',
        subject: 'Team',
        description: null,
        size: 2,
        joinApproval: true,
      },
    });
    expect(calls[2]).toEqual(['inviteInfo', 'AbCdEf1234567890abcdef']);
    expect(await socket.groups({ type: 'accept_invite', code: 'AbCdEf1234567890abcdef' })).toEqual({
      joined: { groupId: '120363000000000009', requested: false },
    });
  });

  it('a join that needs approval returns no group id: it was only requested', async () => {
    const { socket, sock } = await open();
    sock.groupAcceptInvite = rec('accept', undefined) as never;
    expect(await socket.groups({ type: 'accept_invite', code: 'AbCdEf1234567890abcdef' })).toEqual({
      joined: { groupId: null, requested: true },
    });
  });

  it('a malformed invite is refused as WhatsApp would, before any call', async () => {
    const { socket } = await open();
    await expect(
      socket.groups({ type: 'accept_invite', code: 'not a code!' }),
    ).rejects.toMatchObject({ data: 400 });
    expect(calls).toEqual([]);
  });

  it('the picture goes to the group id; remove clears it', async () => {
    const { socket } = await open();
    const data = Buffer.from('jpeg');
    await socket.groups({ type: 'picture', groupJid: '1203', data });
    await socket.groups({ type: 'picture', groupJid: '1203', remove: true });
    expect(calls).toEqual([
      ['picture', '1203@g.us', data],
      ['removePicture', '1203@g.us'],
    ]);
    await expect(socket.groups({ type: 'picture', groupJid: '1203' })).rejects.toThrow();
  });
});

describe('sends into a group', () => {
  it('every kind goes to the group id, never to a phone number made from it', async () => {
    const { socket } = await open();
    const ctx = { clientReference: 'c' };
    const gid = '120363000000000001';
    await socket.send(
      {
        type: 'group_text',
        groupJid: gid,
        body: 'hi @919000000002',
        mentions: ['919000000002@s.whatsapp.net'],
      },
      ctx,
    );
    await socket.send({ type: 'text', to: gid, toGroup: true, body: 'plain' }, ctx);
    await socket.send({ type: 'location', to: gid, toGroup: true, latitude: 1, longitude: 2 }, ctx);
    await socket.send(
      { type: 'contact', to: gid, toGroup: true, name: 'A', phone: '919000000002' },
      ctx,
    );
    await socket.send(
      {
        type: 'media',
        to: gid,
        toGroup: true,
        mediaUrl: '',
        data: Buffer.from('x'),
        mimeType: 'image/png',
      },
      ctx,
    );
    // a bare id without the flag is still recognised as a group (18 digits is no phone number)
    await socket.send({ type: 'text', to: gid, body: 'unflagged' }, ctx);
    const targets = calls.filter((c) => c[0] === 'sendMessage').map((c) => c[1]);
    expect(targets).toEqual(Array(6).fill('120363000000000001@g.us'));
    expect(calls[0]![2]).toEqual({
      text: 'hi @919000000002',
      mentions: ['919000000002@s.whatsapp.net'],
    });
  });

  it('a reply quotes the message, with its author in a group', async () => {
    const { socket } = await open();
    await socket.send(
      {
        type: 'group_text',
        groupJid: '1203',
        body: 'ok',
        quote: {
          providerMessageId: 'Q1',
          fromMe: false,
          participant: '919000000002@s.whatsapp.net',
          text: 'hello',
        },
      },
      { clientReference: 'c' },
    );
    expect(calls[0]![3]).toEqual({
      quoted: {
        key: {
          remoteJid: '1203@g.us',
          id: 'Q1',
          fromMe: false,
          participant: '919000000002@s.whatsapp.net',
        },
        message: { conversation: 'hello' },
      },
    });
  });

  it('a person is still addressed by number', async () => {
    const { socket } = await open();
    await socket.send(
      { type: 'text', to: '+91 98000 00001', body: 'hi' },
      { clientReference: 'c' },
    );
    expect(calls[0]![1]).toBe('919800000001@s.whatsapp.net');
  });

  it('reactions in a group thread address the group id', async () => {
    const { socket } = await open();
    await socket.act({
      type: 'react',
      to: '120363000000000001',
      messageId: 'M',
      fromMe: false,
      emoji: '👍',
    });
    expect(calls[0]![1]).toBe('120363000000000001@g.us');
  });
});

describe('group events', () => {
  const fire = (sock: ReturnType<typeof makeSock>, name: string, payload: unknown) =>
    (sock.ev as EventEmitter).emit(name, payload);

  it('a settings change is delivered with what changed, then the group is re-read once', async () => {
    vi.useFakeTimers();
    const { sock, events } = await open();
    fire(sock, 'groups.update', [
      {
        id: '120363000000000001@g.us',
        subject: 'New',
        announce: true,
        joinApprovalMode: false,
        memberAddMode: false,
        author: '919000000002@s.whatsapp.net',
      },
    ]);
    expect(events).toEqual([
      {
        type: 'group_event',
        event: {
          kind: 'update',
          groupId: '120363000000000001',
          author: '919000000002@s.whatsapp.net',
          patch: {
            subject: 'New',
            announce: true,
            joinApproval: false,
            memberAddMode: 'admin_add',
          },
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(calls.filter((c) => c[0] === 'groupMetadata')).toHaveLength(1);
    expect(events[1]).toMatchObject({ type: 'groups', complete: false });
    expect(calls.some((c) => c[0] === 'fetchAll')).toBe(false);
  });

  it('being removed says so and does not try to read the group we cannot see any more', async () => {
    vi.useFakeTimers();
    const { sock, events } = await open();
    fire(sock, 'group-participants.update', {
      id: '120363000000000001@g.us',
      author: '919000000002@s.whatsapp.net',
      participants: ['919000000001@s.whatsapp.net'],
      action: 'remove',
    });
    expect(events[0]).toEqual({
      type: 'group_event',
      event: {
        kind: 'participants',
        groupId: '120363000000000001',
        author: '919000000002@s.whatsapp.net',
        action: 'remove',
        participants: ['919000000001@s.whatsapp.net'],
        selfAffected: true,
      },
    });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(calls).toEqual([]);
  });

  it('someone else leaving is not about us, and re-reads that group only', async () => {
    vi.useFakeTimers();
    const { sock, events } = await open();
    fire(sock, 'group-participants.update', {
      id: '120363000000000001@g.us',
      author: '',
      participants: ['919000000002@s.whatsapp.net'],
      action: 'remove',
    });
    expect(events[0]).toMatchObject({ event: { selfAffected: false, author: null } });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(calls).toEqual([['groupMetadata', '120363000000000001@g.us']]);
  });

  it('a join request is delivered as it arrives', async () => {
    const { sock, events } = await open();
    fire(sock, 'group.join-request', {
      id: '120363000000000001@g.us',
      author: '777@lid',
      participant: '777@lid',
      action: 'created',
      method: 'invite_link',
    });
    expect(events).toEqual([
      {
        type: 'group_event',
        event: {
          kind: 'join_request',
          groupId: '120363000000000001',
          participant: '777@lid',
          author: '777@lid',
          action: 'created',
          method: 'invite_link',
        },
      },
    ]);
  });

  it('a burst across many groups becomes one full read, marked complete', async () => {
    vi.useFakeTimers();
    const { sock, events } = await open();
    for (let i = 0; i < 8; i++) {
      fire(sock, 'group-participants.update', {
        id: `1203630000000000${10 + i}@g.us`,
        author: '',
        participants: ['919000000002@s.whatsapp.net'],
        action: 'add',
      });
    }
    await vi.advanceTimersByTimeAsync(10_200);
    expect(calls.filter((c) => c[0] === 'groupMetadata')).toHaveLength(0);
    expect(calls.filter((c) => c[0] === 'fetchAll')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'groups')).toEqual([
      expect.objectContaining({ type: 'groups', complete: true }),
    ]);
  });
});
