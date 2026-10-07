import { describe, expect, it } from 'vitest';
import type { ConversationRecord, ConversationViewer } from '../../../src/realtime';
import {
  assignedCopy,
  assignedKey,
  capRecipients,
  collapseKeyFor,
  mentionCopy,
  mentionKey,
  messageKey,
  newChatCopy,
  newChatKey,
  newMessageCopy,
  recipientsForAssignment,
  recipientsForMention,
  recipientsForMessage,
  recipientsForNewChat,
  typeForMessage,
} from '../../../src/modules/notifications/conversation-notification-rules';
import { senderName } from '../../../src/modules/notifications/conversation-notification.consumer';

const viewer = (
  userId: number,
  scope: ConversationViewer['scope'],
  teamIds: number[] = [],
): ConversationViewer => ({ userId, scope, teamIds });
const rec = (u: number | null, t: number | null = null): ConversationRecord => ({
  assigneeUserId: u,
  assigneeTeamId: t,
});

// 1 sees all and may reply; 2 sees team threads (in team 10) and may reply; 3 sees only own; 4 has no grant; 5 reads but cannot reply.
const readers = [
  viewer(1, 'all'),
  viewer(2, 'team', [10]),
  viewer(3, 'own'),
  viewer(4, null),
  viewer(5, 'all'),
];
const repliers = [viewer(1, 'all'), viewer(2, 'team', [10]), viewer(3, 'own')];

describe('new chat (row 1)', () => {
  it('assigned to a person: only that person, and only when they may read it', () => {
    expect(recipientsForNewChat(rec(3), readers, repliers)).toEqual([3]);
    expect(recipientsForNewChat(rec(4), readers, repliers)).toEqual([]);
    expect(recipientsForNewChat(rec(99), readers, repliers)).toEqual([]);
  });

  it('assigned to a team: the members of that team who may read it (not the whole workspace)', () => {
    expect(recipientsForNewChat(rec(null, 10), readers, repliers)).toEqual([2]);
    expect(recipientsForNewChat(rec(null, 77), readers, repliers)).toEqual([]);
  });

  it('unassigned (D1): everyone who may read AND reply; someone who can only read is not told', () => {
    expect(recipientsForNewChat(rec(null), readers, repliers).sort()).toEqual([1, 2]);
  });

  it('a person who sees only their own threads is not told about an unassigned one', () => {
    expect(recipientsForNewChat(rec(null), readers, repliers)).not.toContain(3);
  });
});

describe('new message (row 2)', () => {
  it('goes to the owner, and to nobody when the thread is unassigned', () => {
    expect(recipientsForMessage(rec(3), readers)).toEqual([3]);
    expect(recipientsForMessage(rec(null), readers)).toEqual([]);
  });

  it('a team-assigned thread without a person tells the team members who may read it', () => {
    expect(recipientsForMessage(rec(null, 10), readers)).toEqual([2]);
  });

  it('an owner who lost read access is not told', () => {
    expect(recipientsForMessage(rec(4), readers)).toEqual([]);
  });
});

describe('assigned to me (row 3)', () => {
  it('tells the new assignee', () => {
    expect(
      recipientsForAssignment({ toUserId: 3, toTeamId: null, byUserId: 1 }, rec(3), readers),
    ).toEqual({ userIds: [3], team: false });
  });

  it('never tells the person who assigned it to themselves', () => {
    expect(
      recipientsForAssignment({ toUserId: 3, toTeamId: null, byUserId: 3 }, rec(3), readers),
    ).toEqual({ userIds: [], team: false });
  });

  it('an unassignment tells nobody', () => {
    expect(
      recipientsForAssignment({ toUserId: null, toTeamId: null, byUserId: 1 }, rec(null), readers),
    ).toEqual({ userIds: [], team: false });
  });

  it('a team assignment tells the team members who may read it, except the actor, flagged as team-wide', () => {
    const wide = [viewer(2, 'team', [10]), viewer(6, 'all', [10]), viewer(7, 'all', [11])];
    expect(
      recipientsForAssignment({ toUserId: null, toTeamId: 10, byUserId: 6 }, rec(null, 10), wide),
    ).toEqual({ userIds: [2], team: true });
  });

  it('an assignee who may not read the thread is not told', () => {
    expect(
      recipientsForAssignment({ toUserId: 4, toTeamId: null, byUserId: 1 }, rec(4), readers),
    ).toEqual({ userIds: [], team: false });
  });

  it('a system assignment (routing, no actor) still tells the assignee', () => {
    expect(
      recipientsForAssignment({ toUserId: 3, toTeamId: null, byUserId: null }, rec(3), readers),
    ).toEqual({ userIds: [3], team: false });
  });
});

describe('mentioned in a note (row 4)', () => {
  it('tells each mentioned person who may see the thread, never the author, no repeats', () => {
    expect(recipientsForMention([1, 1, 2, 5], 1, rec(null), readers).sort()).toEqual([2, 5]);
  });

  it('skips a mentioned person who cannot see the conversation', () => {
    // 3 sees only their own threads and 4 has no grant: neither sees an unassigned one.
    expect(recipientsForMention([3, 4], 1, rec(null), readers)).toEqual([]);
    expect(recipientsForMention([3, 4], 1, rec(3), readers)).toEqual([3]);
  });
});

describe('the recipient cap', () => {
  it('keeps the lowest ids, so a redelivery picks the same people, and says it truncated', () => {
    const ids = Array.from({ length: 80 }, (_, i) => 200 - i);
    const capped = capRecipients(ids, 50);
    expect(capped.userIds).toHaveLength(50);
    expect(capped.userIds[0]).toBe(121);
    expect(capped.truncated).toBe(true);
    expect(capRecipients([3, 1, 3], 50)).toEqual({ userIds: [1, 3], truncated: false });
  });
});

describe('dedupe and collapse keys', () => {
  it('contain the event so a redelivery collides and a second real event does not', () => {
    expect(newChatKey('c', '7')).toBe('new_chat:c:7');
    expect(newChatKey('c', '7')).not.toBe(newChatKey('c', '8'));
    expect(messageKey('9')).toBe('message.received:9');
    expect(assignedKey('c', 'u', '4')).not.toBe(assignedKey('c', 'u', '5'));
    expect(mentionKey('n', 'u')).toBe('mention:n:u');
  });

  it('one collapse key per chat, shared by every message of it', () => {
    expect(collapseKeyFor('abc')).toBe('msg:abc');
  });

  it('the first message is a new chat, later ones are messages', () => {
    expect(typeForMessage(true)).toBe('new_chat');
    expect(typeForMessage(false)).toBe('new_message');
  });
});

describe('English fallback wording', () => {
  it('words a collapsed row by its count', () => {
    expect(newMessageCopy('Ada', 'hi', 1).title).toBe('New message from Ada');
    expect(newMessageCopy('Ada', 'hi', 3).title).toBe('3 new messages from Ada');
    expect(newMessageCopy(null, 'hi', 2).title).toBe('2 new messages from a customer');
  });

  it('cuts a long preview to 80 characters', () => {
    expect(newChatCopy('Ada', 'x'.repeat(200)).body).toHaveLength(80);
    expect(newChatCopy('Ada', '').body).toBeNull();
  });

  it('words assignment and mention', () => {
    expect(assignedCopy('Ada', 'Bo', false)).toEqual({
      title: 'Conversation assigned to you',
      body: 'Ada (by Bo)',
    });
    expect(assignedCopy('Ada', null, true).title).toBe('Conversation assigned to your team');
    expect(mentionCopy('Bo', 'please look').title).toBe('Bo mentioned you in a note');
  });
});

describe('how a notification names the sender (decision D4)', () => {
  const base = {
    title: 'whatever',
    peer_name: null,
    peer_key: '919812345678',
    channel_kind: 'whatsapp_cloud',
  };
  it('uses the sender own name', () => {
    expect(senderName({ ...base, peer_name: ' Ada ' })).toBe('Ada');
  });
  it('never puts a bare phone number in a notification: the last four digits only', () => {
    expect(senderName(base)).toBe('…5678');
    expect(senderName(base)).not.toContain('9198');
  });
  it('uses a group title for a group, and nothing for a nameless visitor', () => {
    expect(senderName({ ...base, peer_key: 'g:120363', title: 'Team group' })).toBe('Team group');
    expect(senderName({ ...base, channel_kind: 'webchat', peer_key: 'visitor-1' })).toBeNull();
  });
});
