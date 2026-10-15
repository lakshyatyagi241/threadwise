import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ConsentNotice,
  type ConsentNoticeScope,
  type PublicConsentNotice,
  type SaveConsentNoticeInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ConsentNoticeRepository, type NoticeRow } from './consent-notice.repository';

const MODULE_KEY = 'contact_consent';

const toNotice = (scope: ConsentNoticeScope, ref: string, r: NoticeRow | null): ConsentNotice => ({
  scope,
  ref,
  enabled: r?.enabled ?? false,
  text: r?.text ?? '',
  url: r?.url ?? null,
  termsUrl: r?.termsUrl ?? null,
  channels: (r?.channels ?? []) as ConsentNotice['channels'],
  version: r?.version ?? 0,
  updatedAt: r?.createdAt ?? null,
});

const publicOf = (r: NoticeRow): PublicConsentNotice => ({
  text: r.text,
  version: r.version,
  url: r.url,
  termsUrl: r.termsUrl,
  channels: r.channels as PublicConsentNotice['channels'],
});

/**
 * The versioned wording of each intake point (the website chat widget, a booking type, a store integration). A save that changes
 * nothing writes nothing; a save that changes the text, the link or the on/off state appends the next version. Public pages and the
 * grant writers read the CURRENT notice, or a named version (the one the visitor saw).
 */
@Injectable()
export class ConsentNoticeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConsentNoticeRepository,
    private readonly audit: AuditService,
  ) {}

  async get(scope: ConsentNoticeScope, ref: string): Promise<ConsentNotice> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      await this.requireTarget(tx, orgId, scope, ref);
      return toNotice(scope, ref, await this.repo.current(tx, orgId, scope, ref));
    });
  }

  async save(
    scope: ConsentNoticeScope,
    ref: string,
    input: SaveConsentNoticeInput,
  ): Promise<ConsentNotice> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.requireTarget(tx, ctx.orgId, scope, ref);
      const cur = await this.repo.current(tx, ctx.orgId, scope, ref);
      const same =
        cur !== null &&
        cur.enabled === input.enabled &&
        cur.text === input.text &&
        (cur.url ?? null) === (input.url ?? null) &&
        (cur.termsUrl ?? null) === (input.termsUrl ?? null) &&
        [...cur.channels].sort().join() === [...input.channels].sort().join();
      if (same) return toNotice(scope, ref, cur);
      // Nothing to preserve and nothing on: do not create a version just to say "off".
      if (
        cur === null &&
        !input.enabled &&
        input.text === '' &&
        !input.url &&
        !input.termsUrl &&
        input.channels.length === 0
      ) {
        return toNotice(scope, ref, null);
      }
      const next = (cur?.version ?? 0) + 1;
      const rowId = await this.repo.insert(tx, ctx.orgId, {
        scope,
        ref,
        version: next,
        enabled: input.enabled,
        text: input.text,
        url: input.url ?? null,
        termsUrl: input.termsUrl ?? null,
        channels: [...new Set(input.channels)],
        createdBy: ctx.userId,
      });
      // The wording itself is not copied into the audit row (the version row is the record); the audit says who moved it to which version.
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: rowId,
        action: 'insert',
        delta: {
          [`notice:${scope}:${ref}`]: {
            old: cur ? { version: cur.version, enabled: cur.enabled } : null,
            new: { version: next, enabled: input.enabled },
          },
        },
      });
      return toNotice(scope, ref, await this.repo.current(tx, ctx.orgId, scope, ref));
    });
  }

  /** What a public page shows: the enabled notice, or null (no consent line). Inside the caller's transaction. */
  async publicCurrent(
    tx: Tx,
    orgId: number,
    scope: ConsentNoticeScope,
    ref: string,
  ): Promise<PublicConsentNotice | null> {
    const r = await this.repo.current(tx, orgId, scope, ref);
    return r && r.enabled ? publicOf(r) : null;
  }

  /**
   * The notice a visitor saw when they ticked the box: the version their page named when it is a real, enabled version of THIS
   * intake point, else null (an invented or unknown version never earns a grant).
   */
  async seen(
    tx: Tx,
    orgId: number,
    scope: ConsentNoticeScope,
    ref: string,
    version: number,
  ): Promise<PublicConsentNotice | null> {
    const r = await this.repo.version(tx, orgId, scope, ref, version);
    return r && r.enabled ? publicOf(r) : null;
  }

  private async requireTarget(
    tx: Tx,
    orgId: number,
    scope: ConsentNoticeScope,
    ref: string,
  ): Promise<void> {
    if (!(await this.repo.targetExists(tx, orgId, scope, ref))) {
      throw new AppError(
        ERROR_CODES.CONSENT_NOTICE_TARGET_NOT_FOUND,
        'That widget, booking page, store or language does not exist in this workspace.',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
