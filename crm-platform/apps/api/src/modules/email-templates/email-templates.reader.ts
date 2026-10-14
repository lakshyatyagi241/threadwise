import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, type EmailTemplatePurpose } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { EmailTemplatesRepository } from './email-templates.repository';

/**
 * What the send path needs from the template library, and nothing else: the reply composer names a template (`templateId`) and the inbox
 * asks here, in the sender's own transaction, whether the sender may use it and whether it is marketing mail; the email channel counts a
 * use after the provider accepted the reply. Reading goes through the same visibility rule as the library (a colleague's personal
 * template does not exist for you).
 */
@Injectable()
export class EmailTemplatesReader {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: EmailTemplatesRepository,
  ) {}

  /**
   * The purpose of the template a reply names. 404 EMAIL_TEMPLATE_NOT_FOUND when it does not exist for the sender, 422
   * EMAIL_TEMPLATE_ARCHIVED when it was archived: a reply is never sent from a template the library no longer offers.
   */
  async purposeForReply(
    tx: Tx,
    orgId: number,
    userId: number,
    uuid: string,
  ): Promise<EmailTemplatePurpose> {
    const found = await this.repo.forSend(tx, orgId, userId, uuid);
    if (!found) {
      throw new AppError(
        ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND,
        'Email template not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (found.status === 'archived') {
      throw new AppError(
        ERROR_CODES.EMAIL_TEMPLATE_ARCHIVED,
        'This template is archived. Restore it to use it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return found.purpose;
  }

  /**
   * Counts one sent use of a template. Never throws: the mail is already gone, so a bookkeeping failure must not fail or repeat the send;
   * a template deleted in the meantime counts nothing.
   */
  async recordUse(orgId: number, userId: number | null, uuid: string): Promise<void> {
    await this.db.txAs(userId ? { orgId, userId } : { orgId }, async (tx) => {
      const found = userId
        ? await this.repo.forSend(tx, orgId, userId, uuid)
        : await this.repo.forSend(tx, orgId, -1, uuid);
      if (found) await this.repo.bumpUsage(tx, orgId, found.id);
    });
  }
}
