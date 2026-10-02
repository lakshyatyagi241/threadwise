import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type AcceptWspInviteInput,
  type Authenticated,
  type WspInvitePreview,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  AccountGateService,
  LoginService,
  PasswordService,
  RateLimitService,
  TenantDirectory,
  UserTokensService,
} from '../auth';
import { MembersRepository } from './members.repository';
import { toMemberStatus } from './members.mapper';

/** Guests may try this many invitation links per address in ten minutes; a real invitee needs one or two. */
const ATTEMPTS_PER_IP = 20;
const WINDOW_SECONDS = 10 * 60;

/**
 * The invitee's side of an invitation (TW-WSP-016, 021): look at it, then accept it by choosing a password. No account exists
 * to sign in to until then, so both calls are public; the token is the credential, and every way it can be wrong (unknown
 * workspace, unknown token, used, expired, member removed meanwhile, workspace suspended) answers the same 400
 * WSP_INVITE_INVALID, so the endpoints cannot be used to probe for workspaces, people or tokens.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MembersRepository,
    private readonly outbox: OutboxService,
    private readonly tenants: TenantDirectory,
    private readonly tokens: UserTokensService,
    private readonly passwords: PasswordService,
    private readonly gates: AccountGateService,
    private readonly login: LoginService,
    private readonly rate: RateLimitService,
  ) {}

  async preview(token: string, orgSlug: string): Promise<WspInvitePreview> {
    await this.throttle();
    const { org, userId, payload } = await this.openInvitation(token, orgSlug);
    return this.db.txAs({ orgId: org.id }, async (tx) => {
      const user = await this.requirePending(tx, org.id, userId);
      const roles = await this.repo.rolesForUsers(tx, org.id, [userId]);
      const inviter = Number(payload.invitedBy);
      return {
        workspaceName: org.name,
        email: user.email,
        fullName: user.fullName,
        roleName: roles[0]?.roleName ?? '',
        invitedBy: Number.isInteger(inviter)
          ? await this.repo.displayName(tx, org.id, inviter)
          : null,
      };
    });
  }

  async accept(input: AcceptWspInviteInput): Promise<Authenticated> {
    await this.throttle();
    const ctx = RequestContextStore.require();
    const { org, userId } = await this.openInvitation(input.token, input.orgSlug);

    const user = await this.db.txAs({ orgId: org.id }, (tx) =>
      this.requirePending(tx, org.id, userId),
    );
    // Before the token is spent: a password the policy refuses must not burn the invitation.
    await this.passwords.assertAcceptable(input.password, {
      email: user.email,
      fullName: user.fullName,
    });
    const passwordHash = await this.passwords.hash(input.password);

    await this.db.txAs({ orgId: org.id, userId }, async (tx) => {
      const consumed = await this.tokens.consume(tx, org.id, 'invite', input.token);
      if (
        !consumed ||
        consumed.userId !== userId ||
        !(await this.repo.markJoined(tx, org.id, userId, passwordHash))
      ) {
        throw this.invalid();
      }
      await this.repo.markEmailVerifiedAndPassword(tx, org.id, userId);
      await this.repo.audit(tx, {
        orgId: org.id,
        actorId: userId,
        actorType: 'user',
        module: 'members',
        recordId: userId,
        action: 'member.joined',
        delta: { email: { old: null, new: user.email } },
        requestId: ctx.requestId,
      });
      await this.outbox.emit(tx, {
        orgId: org.id,
        aggregateModule: 'members',
        aggregateId: userId,
        eventType: 'member.joined',
        payload: { uuid: user.uuid, email: user.email },
      });
    });
    await this.gates.invalidate(org.id, userId);

    // Accepting is the first sign-in: no second factor can exist yet, so the session opens the way a sign-up does.
    return this.login.completeLogin({
      org: { id: org.id, slug: org.slug, settings: org.settings },
      user: { id: userId, uuid: user.uuid, email: user.email, fullName: user.fullName },
      remember: false,
      mfaVerified: false,
      method: 'invite',
      meta: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    });
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async throttle(): Promise<void> {
    const ip = RequestContextStore.peek()?.ip ?? 'unknown';
    if (!(await this.rate.allow(`wsp:invite:${ip}`, ATTEMPTS_PER_IP, WINDOW_SECONDS))) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many attempts. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** The active workspace and the invited user a live token points at, or the generic refusal. */
  private async openInvitation(token: string, orgSlug: string) {
    const org = await this.tenants.findOrgBySlug(orgSlug);
    if (!org || org.status !== 'active') throw this.invalid();
    const peeked = await this.tokens.peek(org.id, 'invite', token);
    if (!peeked) throw this.invalid();
    return { org, userId: peeked.userId, payload: peeked.payload };
  }

  private async requirePending(tx: Tx, orgId: number, userId: number) {
    const row = await this.repo.byId(tx, orgId, null, userId);
    if (!row || toMemberStatus(row) !== 'pending') throw this.invalid();
    return row;
  }

  private invalid(): AppError {
    return new AppError(
      ERROR_CODES.WSP_INVITE_INVALID,
      'This invitation link is invalid or has expired. Ask your administrator to send it again.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
