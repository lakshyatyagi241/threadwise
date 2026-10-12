import { Injectable } from '@nestjs/common';
import { DEFAULT_MAIL_WORKSPACE_SETTINGS, type MailWorkspaceSettings } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { DatabaseService } from '../../infra/db/database.service';
import { personalConnectRefusal, type MailActor } from './mail-personal-policy';
import { MailboxesRepository } from './mailboxes.repository';

/** The three permissions the personal-mailbox rules read (`mail-personal-policy.ts` says what each means). */
export const MAIL_PERM = {
  manage: 'mail.mailboxes.manage',
  managePersonal: 'mail.mailboxes.manage_personal',
  settings: 'mail.settings.manage',
} as const;

/** Who the caller is for the personal-mailbox rules, and the workspace policy they run under. */
@Injectable()
export class MailAccess {
  constructor(
    private readonly db: DatabaseService,
    private readonly rbac: RbacService,
    private readonly repo: MailboxesRepository,
  ) {}

  /** The current request's user as the rules see them (their grants were resolved by the permission guard). */
  actor(): MailActor {
    const ctx = RequestContextStore.require();
    const grants = ctx.grants ?? new Map();
    return {
      userId: ctx.userId ?? null,
      canManageShared: this.rbac.can(grants, MAIL_PERM.manage).allowed,
      canManagePersonal: this.rbac.can(grants, MAIL_PERM.managePersonal).allowed,
      isAdmin: this.rbac.can(grants, MAIL_PERM.settings).allowed,
    };
  }

  /** The workspace policy, the contract's defaults while it never saved one. Read fresh. */
  async policy(tx: Tx, orgId: number): Promise<MailWorkspaceSettings> {
    return (await this.repo.workspaceSettings(tx, orgId)) ?? { ...DEFAULT_MAIL_WORKSPACE_SETTINGS };
  }

  /** A user outside a request (the OAuth callback finishing a connect) as the rules see them, from their current grants. */
  async actorOf(orgId: number, userId: number | null): Promise<MailActor> {
    const grants = userId === null ? new Map() : await this.rbac.grantsForUser(orgId, userId);
    return {
      userId,
      canManageShared: this.rbac.can(grants, MAIL_PERM.manage).allowed,
      canManagePersonal: this.rbac.can(grants, MAIL_PERM.managePersonal).allowed,
      isAdmin: this.rbac.can(grants, MAIL_PERM.settings).allowed,
    };
  }

  /** Why this user may not connect a NEW personal mailbox right now (policy off, or not among who may), or null. */
  async personalRefusalFor(
    orgId: number,
    userId: number | null,
  ): Promise<'disabled' | 'not_allowed' | null> {
    const [actor, policy] = await Promise.all([
      this.actorOf(orgId, userId),
      this.db.txAs({ orgId, userId }, (tx) => this.policy(tx, orgId)),
    ]);
    return personalConnectRefusal(actor, policy);
  }
}
