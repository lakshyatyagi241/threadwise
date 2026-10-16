import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type MailConnectionTestResponse,
  type TestImapMailboxInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { MailAccess } from './mail-access.service';
import { openConnection, passwordConnectionOf } from './mail-connection';
import { mailboxUnavailable } from './mail-errors';
import { mayAct, viewOf } from './mail-personal-policy';
import { TEST_LIMIT_PER_MINUTE, TEST_WINDOW_MS } from './mail-test-rules';
import { MailLimits } from './mail-limits';
import { MailboxesRepository } from './mailboxes.repository';

/**
 * "Test credentials" for IMAP/SMTP mailboxes (E-08): the server tries the two logins and reports each side, so a person can fix the
 * settings BEFORE connecting (`testNew`, from the settings typed in the dialog) or find out why a connected mailbox stopped working
 * (`testStored`, with the login it already holds: that password never leaves the server).
 *
 * Safety: a test opens connections to a host the caller named, so it goes through the same SSRF guard and certificate rules as connect
 * and sync (`host-guard`, validated TLS), is limited to {@link TEST_LIMIT_PER_MINUTE} runs a minute per workspace (429
 * `MAIL_RATE_LIMITED`), reports only OUR sentences (never a host, a banner or a password), and stores and sends nothing. Because it
 * changes nothing it writes no audit row; the run is logged with the workspace and the person, never the settings.
 */
@Injectable()
export class MailConnectionTester {
  private readonly logger = new Logger(MailConnectionTester.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly drivers: MailDriverRegistry,
    private readonly repo: MailboxesRepository,
    private readonly access: MailAccess,
    private readonly crypto: CryptoService,
    private readonly limits: MailLimits,
  ) {}

  /** The settings typed in the connect dialog. */
  async testNew(input: TestImapMailboxInput): Promise<MailConnectionTestResponse> {
    const ctx = RequestContextStore.require();
    await this.throttle(ctx.orgId);
    const result = await this.drivers.password('imap').test(passwordConnectionOf(input));
    this.logger.log({ orgId: ctx.orgId, userId: ctx.userId, ok: result.ok }, 'mail credentials tested');
    return result;
  }

  /**
   * A connected IMAP mailbox, with its stored login. Allowed on `connected`, `error` and `needs_reauth` (the last is when it is most
   * useful: the server refused the saved password). Needs the right to act on the mailbox, like Sync now.
   */
  async testStored(uuid: string): Promise<MailConnectionTestResponse> {
    const ctx = RequestContextStore.require();
    const actor = this.access.actor();
    const row = await this.db.tx(async (tx) => {
      const found = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!found) throw AppError.notFound('Mailbox', uuid);
      if (viewOf(actor, found, await this.access.policy(tx, ctx.orgId)) === 'none') {
        throw AppError.notFound('Mailbox', uuid);
      }
      if (!mayAct(actor, found, 'sync')) {
        throw AppError.forbidden(
          found.scope === 'shared' ? 'mail.mailboxes.manage' : 'mail.mailboxes.manage_personal',
        );
      }
      return found;
    });
    const driver = this.drivers.password(row.provider);
    if (row.status === 'disconnected') {
      throw mailboxUnavailable('This mailbox is disconnected.');
    }
    const login = openConnection(this.crypto, row.connectionEnc)?.login;
    if (!login) throw mailboxUnavailable('This mailbox has no saved login. Reconnect it.');
    await this.throttle(ctx.orgId);
    const result = await driver.test(login);
    this.logger.log(
      { orgId: ctx.orgId, userId: ctx.userId, mailbox: row.uuid, ok: result.ok },
      'mail credentials tested',
    );
    return result;
  }

  private async throttle(orgId: number): Promise<void> {
    const over = await this.limits.hitAndCheck(`mail:test:${orgId}`, TEST_WINDOW_MS, TEST_LIMIT_PER_MINUTE);
    if (over) {
      throw new AppError(
        ERROR_CODES.MAIL_RATE_LIMITED,
        'Too many connection tests in a short time. Wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
