import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  CreateMailSignatureInput,
  ListMailSignaturesQuery,
  MailSignatureListResponse,
  MailSignatureResponse,
  UpdateMailSignatureInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { outboundText, sanitizeOutboundHtml } from '../../infra/providers/channel-email';
import { AuditService } from '../../kernel/audit/audit.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { signatureNotFound } from './mail-outbound-errors';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';
import { MailSignaturesRepository, type SignatureRow } from './mail-signatures.repository';

export const MAIL_SIGNATURE_AUDIT_MODULE = 'mail_signatures';

const toResponse = (s: SignatureRow): MailSignatureResponse => ({
  id: s.uuid,
  scope: s.scope,
  mailboxId: s.mailboxUuid,
  userId: s.userUuid,
  name: s.name,
  bodyHtml: s.bodyHtml,
  bodyText: s.bodyText,
  isDefault: s.isDefault,
  rowVersion: s.rowVersion,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/** A personal mailbox is the owner's alone; a shared one is everyone's. */
const mailboxVisible = (
  m: { scope: string; ownerUserId: number | null },
  userId: number,
): boolean => m.scope !== 'personal' || m.ownerUserId === userId;

/**
 * Email signatures (TW-MAIL-027). Two kinds: the shared signature of a mailbox (managed with `mail.signatures.manage` plus
 * `mail.mailboxes.manage` on a shared mailbox, by the owner on a personal one) and an agent's own (anyone with `mail.signatures.manage`,
 * only theirs: another person's user signature does not exist for you). HTML is sanitised on write, the text part derived when not given.
 * One default per mailbox and per user: making one the default clears the other. Every change is audited.
 */
@Injectable()
export class MailSignaturesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailSignaturesRepository,
    private readonly mailboxes: MailboxesRepository,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListMailSignaturesQuery): Promise<MailSignatureListResponse> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId! }, (tx) =>
      this.repo.listVisible(tx, ctx.orgId, ctx.userId!),
    );
    const data = rows
      .filter(
        (s) =>
          s.scope === 'user' ||
          (s.mailboxScope !== null &&
            mailboxVisible(
              { scope: s.mailboxScope, ownerUserId: s.mailboxOwnerUserId },
              ctx.userId!,
            )),
      )
      .filter((s) => !query.scope || s.scope === query.scope)
      .filter((s) => !query.mailboxId || s.mailboxUuid === query.mailboxId)
      .map(toResponse);
    return { data };
  }

  async create(input: CreateMailSignatureInput): Promise<MailSignatureResponse> {
    const ctx = RequestContextStore.require();
    const userId = ctx.userId!;
    return this.db.txAs({ orgId: ctx.orgId, userId }, async (tx) => {
      let mailboxId: number | null = null;
      if (input.scope === 'mailbox') {
        const mailbox = await this.mailboxes.byUuid(tx, ctx.orgId, input.mailboxId!);
        mailboxId = this.assertManageMailbox(mailbox, ctx.grants, userId).id;
      }
      const bodyHtml = sanitizeOutboundHtml(input.bodyHtml);
      const bodyText = input.bodyText.trim() !== '' ? input.bodyText : outboundText(bodyHtml);
      if (input.isDefault) {
        await this.repo.clearDefaults(
          tx,
          ctx.orgId,
          mailboxId !== null ? { mailboxId } : { userId },
          null,
        );
      }
      const id = await this.repo.insert(tx, ctx.orgId, {
        scope: input.scope,
        mailboxId,
        userId: input.scope === 'user' ? userId : null,
        name: input.name,
        bodyHtml,
        bodyText,
        isDefault: input.isDefault,
        createdBy: userId,
      });
      await this.audit.record(tx, {
        module: MAIL_SIGNATURE_AUDIT_MODULE,
        recordId: id,
        action: 'insert',
        delta: { name: { old: null, new: input.name }, scope: { old: null, new: input.scope } },
      });
      const row = await this.byInternalId(tx, ctx.orgId, id);
      return toResponse(row);
    });
  }

  async update(uuid: string, input: UpdateMailSignatureInput): Promise<MailSignatureResponse> {
    const ctx = RequestContextStore.require();
    const userId = ctx.userId!;
    return this.db.txAs({ orgId: ctx.orgId, userId }, async (tx) => {
      const before = await this.owned(tx, ctx.orgId, uuid, userId, ctx.grants, true);
      const patch: Parameters<MailSignaturesRepository['update']>[4] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.bodyHtml !== undefined) {
        patch.bodyHtml = sanitizeOutboundHtml(input.bodyHtml);
        patch.bodyText =
          input.bodyText !== undefined && input.bodyText.trim() !== ''
            ? input.bodyText
            : outboundText(patch.bodyHtml);
      } else if (input.bodyText !== undefined) {
        patch.bodyText = input.bodyText;
      }
      if (input.isDefault !== undefined) patch.isDefault = input.isDefault;
      if (input.isDefault) {
        await this.repo.clearDefaults(
          tx,
          ctx.orgId,
          before.mailboxId !== null ? { mailboxId: before.mailboxId } : { userId: before.userId! },
          before.id,
        );
      }
      const ok = await this.repo.update(tx, ctx.orgId, before.id, input.rowVersion, patch);
      if (!ok) throw AppError.rowVersionConflict('Signature');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (patch.name !== undefined && patch.name !== before.name) {
        delta.name = { old: before.name, new: patch.name };
      }
      if (patch.bodyHtml !== undefined && patch.bodyHtml !== before.bodyHtml) {
        delta.bodyHtml = { old: '(changed)', new: '(changed)' };
      }
      if (patch.isDefault !== undefined && patch.isDefault !== before.isDefault) {
        delta.isDefault = { old: before.isDefault, new: patch.isDefault };
      }
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: MAIL_SIGNATURE_AUDIT_MODULE,
          recordId: before.id,
          action: 'update',
          delta,
        });
      }
      return toResponse(await this.byInternalId(tx, ctx.orgId, before.id));
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const userId = ctx.userId!;
    await this.db.txAs({ orgId: ctx.orgId, userId }, async (tx) => {
      const row = await this.owned(tx, ctx.orgId, uuid, userId, ctx.grants, true);
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: MAIL_SIGNATURE_AUDIT_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { name: { old: row.name, new: null } },
      });
    });
  }

  private async byInternalId(
    tx: Parameters<MailSignaturesRepository['byUuid']>[0],
    orgId: number,
    id: number,
  ) {
    const res = await tx.execute(
      sql`SELECT uuid FROM mail_signatures WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const uuid = (res.rows[0] as { uuid: string }).uuid;
    return (await this.repo.byUuid(tx, orgId, uuid))!;
  }

  /** The signature when the caller may change it; otherwise the same 404 as a signature that does not exist. */
  private async owned(
    tx: Parameters<MailSignaturesRepository['byUuid']>[0],
    orgId: number,
    uuid: string,
    userId: number,
    grants: Parameters<RbacService['can']>[0] | undefined,
    forUpdate: boolean,
  ): Promise<SignatureRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid, forUpdate);
    if (!row) throw signatureNotFound();
    if (row.scope === 'user') {
      if (row.userId !== userId) throw signatureNotFound();
      return row;
    }
    const mailbox = await this.mailboxes.byUuid(tx, orgId, row.mailboxUuid!);
    this.assertManageMailbox(mailbox, grants, userId);
    return row;
  }

  /** A shared mailbox's signature needs `mail.mailboxes.manage`; a personal mailbox's is its owner's; any other personal mailbox is not there. */
  private assertManageMailbox(
    mailbox: MailboxRow | undefined,
    grants: Parameters<RbacService['can']>[0] | undefined,
    userId: number,
  ): MailboxRow {
    if (!mailbox || !mailboxVisible(mailbox, userId)) throw AppError.notFound('Mailbox');
    if (
      mailbox.scope === 'shared' &&
      !this.rbac.can(grants ?? new Map(), 'mail.mailboxes.manage').allowed
    ) {
      throw AppError.forbidden('mail.mailboxes.manage');
    }
    return mailbox;
  }
}
