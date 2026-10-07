import type { NotificationType } from '@crm/contracts';
import {
  conversationVisible,
  type ConversationRecord,
  type ConversationViewer,
} from '../../realtime';

/**
 * Who is told about a conversation event, and what the bell row says (docs/specs/realtime-notifications.md section 5, rows 1 to 4).
 * Pure functions over ids already read from the database, so every rule is unit-tested without a database.
 *
 * "Who may see it" is `conversationVisible`, the one rule behind the REST read and every realtime delivery, so a notification can
 * never reach a person the thread itself would be hidden from.
 */

/** The people allowed to read the conversation (`inbox.conversation.read` at their scope). */
export const readersOf = (
  readers: readonly ConversationViewer[],
  record: ConversationRecord,
): ConversationViewer[] => readers.filter((v) => conversationVisible(v, record));

/** The members of the team the conversation is assigned to who may also read it. */
export function teamMembersWhoSee(
  readers: readonly ConversationViewer[],
  record: ConversationRecord,
): ConversationViewer[] {
  const teamId = record.assigneeTeamId;
  if (teamId === null) return [];
  return readersOf(readers, record).filter((v) => v.teamIds.includes(teamId));
}

/**
 * Row 1, a new chat (the first message of a new or reopened thread):
 *   assigned to a person        that person (if they may read it);
 *   assigned to a team          the members of the team who may read it;
 *   unassigned (decision D1)    everyone who may read it AND reply to it.
 */
export function recipientsForNewChat(
  record: ConversationRecord,
  readers: readonly ConversationViewer[],
  repliers: readonly ConversationViewer[],
): number[] {
  if (record.assigneeUserId !== null) {
    return readersOf(readers, record)
      .filter((v) => v.userId === record.assigneeUserId)
      .map((v) => v.userId);
  }
  if (record.assigneeTeamId !== null) {
    return teamMembersWhoSee(readers, record).map((v) => v.userId);
  }
  const canReply = new Set(readersOf(repliers, record).map((v) => v.userId));
  return readersOf(readers, record)
    .filter((v) => canReply.has(v.userId))
    .map((v) => v.userId);
}

/**
 * Row 2, a later message on a chat: the person who owns it, else (team-assigned without a person) the team's members who may read it.
 * An unassigned chat tells nobody new: everyone who could answer it heard at row 1.
 */
export function recipientsForMessage(
  record: ConversationRecord,
  readers: readonly ConversationViewer[],
): number[] {
  if (record.assigneeUserId !== null) {
    return readersOf(readers, record)
      .filter((v) => v.userId === record.assigneeUserId)
      .map((v) => v.userId);
  }
  return teamMembersWhoSee(readers, record).map((v) => v.userId);
}

export interface AssignmentFacts {
  /** The person it was assigned to now (internal id), null when assigned to a team only or unassigned. */
  toUserId: number | null;
  toTeamId: number | null;
  /** Who made the change (internal id); null for the system (routing). */
  byUserId: number | null;
}

/**
 * Row 3, assigned to me. A person assignment tells that person (never themself, never an unassignment); a team-only assignment tells
 * the team's members who may read it, except whoever made the change. `team` marks the second case: it fills the bell without a toast.
 */
export function recipientsForAssignment(
  facts: AssignmentFacts,
  record: ConversationRecord,
  readers: readonly ConversationViewer[],
): { userIds: number[]; team: boolean } {
  if (facts.toUserId !== null) {
    if (facts.toUserId === facts.byUserId) return { userIds: [], team: false };
    const may = readersOf(readers, record).some((v) => v.userId === facts.toUserId);
    return { userIds: may ? [facts.toUserId] : [], team: false };
  }
  if (facts.toTeamId !== null) {
    const userIds = teamMembersWhoSee(readers, record)
      .map((v) => v.userId)
      .filter((id) => id !== facts.byUserId);
    return { userIds, team: true };
  }
  return { userIds: [], team: false };
}

/** Row 4, mentioned in a note: each mentioned person who may read the conversation, never the author, no repeats. */
export function recipientsForMention(
  mentioned: readonly number[],
  authorUserId: number | null,
  record: ConversationRecord,
  readers: readonly ConversationViewer[],
): number[] {
  const may = new Set(readersOf(readers, record).map((v) => v.userId));
  return [...new Set(mentioned)].filter((id) => id !== authorUserId && may.has(id));
}

/** The hard cap on people per event, with a stable order (lowest id first) so a truncated set is the same on a redelivery. */
export function capRecipients(
  userIds: readonly number[],
  max: number,
): { userIds: number[]; truncated: boolean } {
  const sorted = [...new Set(userIds)].sort((a, b) => a - b);
  return { userIds: sorted.slice(0, max), truncated: sorted.length > max };
}

// --- dedupe keys ---------------------------------------------------------------------------------------------------------------
// Delivery is at-least-once. Every key contains the outbox event id (or the note), so a redelivery writes nothing twice while two real
// events (a reassignment back to the same person, a second reopen) each notify.

export const newChatKey = (conversationUuid: string, eventId: string): string =>
  `new_chat:${conversationUuid}:${eventId}`;
export const messageKey = (eventId: string): string => `message.received:${eventId}`;
export const collapseKeyFor = (conversationUuid: string): string => `msg:${conversationUuid}`;
export const assignedKey = (conversationUuid: string, userUuid: string, eventId: string): string =>
  `assigned:${conversationUuid}:${userUuid}:${eventId}`;
export const mentionKey = (noteUuid: string, userUuid: string): string =>
  `mention:${noteUuid}:${userUuid}`;

// --- wording (English fallback; the web words each type itself from `data`) ----------------------------------------------------

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export interface ConversationCopy {
  title: string;
  body: string | null;
}

export function newChatCopy(name: string | null, preview: string): ConversationCopy {
  const who = name ?? 'a customer';
  return { title: `New chat from ${who}`, body: preview === '' ? null : clip(preview, 80) };
}

export function newMessageCopy(
  name: string | null,
  preview: string,
  count: number,
): ConversationCopy {
  const who = name ?? 'a customer';
  return {
    title: count > 1 ? `${count} new messages from ${who}` : `New message from ${who}`,
    body: preview === '' ? null : clip(preview, 80),
  };
}

export function assignedCopy(
  name: string | null,
  byName: string | null,
  team: boolean,
): ConversationCopy {
  const who = name ?? 'a customer';
  return {
    title: team ? 'Conversation assigned to your team' : 'Conversation assigned to you',
    body: byName ? `${who} (by ${byName})` : who,
  };
}

export function mentionCopy(authorName: string | null, noteExcerpt: string): ConversationCopy {
  return {
    title: `${authorName ?? 'Someone'} mentioned you in a note`,
    body: noteExcerpt === '' ? null : clip(noteExcerpt, 80),
  };
}

/** The type a `message.received` event becomes. */
export const typeForMessage = (firstInbound: boolean): NotificationType =>
  firstInbound ? 'new_chat' : 'new_message';
