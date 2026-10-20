import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, type RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  PERM_CONVERSATION_READ,
  PERM_CONVERSATION_READ_UNASSIGNED,
  PERM_MAIL_SETTINGS_MANAGE,
  adminsCanReadPersonal,
  conversationVisible,
  viewerReadsUnassigned,
  type ConversationRecord,
  type ConversationViewer,
} from '../../realtime';
import { teamIdsForScope } from '../../kernel/rbac/scope';

export const PERM = {
  read: PERM_CONVERSATION_READ,
  reply: 'inbox.conversation.reply',
  assign: 'inbox.conversation.assign',
  assignSelf: 'inbox.conversation.assign_self',
  resolve: 'inbox.conversation.resolve',
  note: 'inbox.conversation.note',
  snooze: 'inbox.conversation.snooze',
  priority: 'inbox.conversation.priority',
  bulk: 'inbox.conversation.bulk',
  tag: 'inbox.conversation.tag',
} as const;

/** The one answer for "no such conversation" and "not one you may see": the two are never told apart. */
export const conversationNotFound = (): AppError =>
  new AppError(ERROR_CODES.CONVERSATION_NOT_FOUND, 'Conversation not found', HttpStatus.NOT_FOUND);

/**
 * Who may see and act on which conversation (plan-inbox-chat.md section 3.7).
 *
 * Seeing is decided by `conversationVisible` with the caller's scope for `inbox.conversation.read`, the same function the realtime
 * layer uses, so the list, the thread and the socket cannot disagree; a conversation outside it is a 404, never a 403, so an agent
 * with scope `own` cannot learn that another agent's conversation exists.
 *
 * Acting (reply, resolve, note, assign) is a second, narrower question: the caller's scope for THAT permission must cover the
 * conversation as well. It is asked only after the conversation is known to be visible, so a refusal here (403) tells the caller
 * nothing they could not already see.
 */
@Injectable()
export class InboxAccess {
  constructor(private readonly rbac: RbacService) {}

  /** The caller as visibility sees them, for a permission's scope (the read scope unless told otherwise). */
  async viewer(
    tx: Tx,
    ctx: RequestContext,
    permission: string = PERM.read,
  ): Promise<ConversationViewer> {
    const can = this.rbac.can(ctx.grants ?? new Map(), permission);
    const scope = can.allowed ? can.scope : null;
    const teamIds = await teamIdsForScope(tx, { orgId: ctx.orgId, userId: ctx.userId! }, scope);
    const readsUnassigned = viewerReadsUnassigned(
      permission,
      scope,
      this.rbac.can(ctx.grants ?? new Map(), PERM_CONVERSATION_READ_UNASSIGNED).allowed,
    );
    // An admin of a workspace whose policy lets admins read personal mailboxes (TW-MAIL-035); everyone else reads only their own.
    const readsPersonalMail =
      can.allowed && this.rbac.can(ctx.grants ?? new Map(), PERM_MAIL_SETTINGS_MANAGE).allowed
        ? await adminsCanReadPersonal(tx, ctx.orgId)
        : false;
    return {
      userId: ctx.userId!,
      scope,
      teamIds: [...teamIds],
      readsUnassigned,
      readsPersonalMail,
    };
  }

  /** The caller's scope for a permission, or null when they do not hold it. */
  scopeOf(ctx: RequestContext, permission: string): RecordScope | null {
    const can = this.rbac.can(ctx.grants ?? new Map(), permission);
    return can.allowed ? can.scope : null;
  }

  canSee(viewer: ConversationViewer, record: ConversationRecord): boolean {
    return conversationVisible(viewer, record);
  }

  /** 404 unless the caller may see the conversation. */
  assertVisible(viewer: ConversationViewer, record: ConversationRecord): void {
    if (!conversationVisible(viewer, record)) throw conversationNotFound();
  }

  /**
   * 403 unless the caller holds `permission` with a scope that covers this conversation. Call it after `assertVisible`.
   * The route guard has already checked that the permission is held at all; this is the record-level half.
   */
  async assertCan(
    tx: Tx,
    ctx: RequestContext,
    permission: string,
    record: ConversationRecord,
  ): Promise<void> {
    const viewer = await this.viewer(tx, ctx, permission);
    if (!conversationVisible(viewer, record)) throw AppError.forbidden(permission);
  }

  /**
   * 403 when the conversation is assigned to another agent: only the assignee sends into it. An unassigned conversation, or one assigned
   * to a team or a bot only, is open to every agent who may reply; internal notes are never locked.
   */
  assertNotAssignedToOther(ctx: RequestContext, record: ConversationRecord): void {
    if (record.assigneeUserId !== null && record.assigneeUserId !== ctx.userId) {
      throw new AppError(
        ERROR_CODES.CONVERSATION_ASSIGNED_TO_OTHER,
        'This chat is assigned to another agent. Assign it to yourself first to reply.',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
