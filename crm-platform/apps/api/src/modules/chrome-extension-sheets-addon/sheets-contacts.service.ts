import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  listContactsQuerySchema,
  type ContactResponse,
  type ExtSheetsContactsQuery,
  type ExtSheetsContactsResponse,
  type ExtSheetsContactsSyncRequest,
  type ExtSheetsContactsSyncResponse,
  type ExtSheetsRowResult,
  type UpdateContactInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  ContactsRepository,
  ContactsService,
  toContactResponse,
  type ContactConsentContext,
} from '../crm';
import { toSheetsContact } from './sheets-addon.mapper';
import type { SheetsCallerState } from './sheets-access';
import { SheetsRunLog } from './sheets-run-log.service';
import {
  failedRow,
  parseContactRows,
  planContactRow,
  summarize,
  type PlannedContact,
} from './sheets-row.rules';

const hash16 = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * The ledger context of a sheet row that says the person agreed. The grant's key is stable for the same person and the same note, so the
 * add-on re-sending a changed row (it does, on edit and on the hourly sweep) records the agreement once, not once per sync. Hashed: no
 * email or phone in the key.
 */
function sheetsConsentVia(c: PlannedContact): ContactConsentContext | undefined {
  if (!c.consent) return undefined;
  const who = (c.email ?? c.phone ?? '').toLowerCase();
  return {
    source: 'api',
    evidence: { reference: 'google_sheets' },
    dedupeKey: `sheets:${hash16(who)}:${hash16(c.consent.note ?? '')}`,
  };
}

/** One lost optimistic-lock race is retried once: a sheet has no `rowVersion` to send. */
const UPDATE_ATTEMPTS = 2;

/**
 * The contacts side of the add-on (TW-EXT-011, 012; new in this port). Everything goes through `ContactsService`, so a row from a sheet has
 * the same identity matching, plan quota, required-property rules, audit and `contact.*` events as one typed in the app, and the same
 * record scope: a member limited to their own contacts reads and edits only those.
 */
@Injectable()
export class SheetsContactsService {
  private readonly logger = new Logger(SheetsContactsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsService,
    private readonly repo: ContactsRepository,
    private readonly rbac: RbacService,
    private readonly runs: SheetsRunLog,
  ) {}

  async pull(query: ExtSheetsContactsQuery): Promise<ExtSheetsContactsResponse> {
    const ctx = RequestContextStore.require();
    const parsed = listContactsQuerySchema.parse({
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
    });
    const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
    const page = await this.contacts.list(parsed, scope);
    return {
      ok: true,
      contacts: page.data.map(toSheetsContact),
      next_cursor: page.page.nextCursor,
      has_more: page.page.hasMore,
    };
  }

  async sync(
    caller: SheetsCallerState,
    body: ExtSheetsContactsSyncRequest,
  ): Promise<ExtSheetsContactsSyncResponse> {
    const results: ExtSheetsRowResult[] = [];
    // Rows go one at a time on purpose: a later row for the same person must see the earlier one, and one bad row must not roll back
    // the others (each row is its own transaction inside `ContactsService`).
    for (const item of parseContactRows(body.rows)) {
      if ('failed' in item) {
        results.push(item.failed);
        continue;
      }
      const plan = planContactRow(item.row, body.default_country_code);
      if (!plan.ok) {
        results.push(
          failedRow(item.index, item.ref, ERROR_CODES.VALIDATION_FAILED, plan.message, plan.field),
        );
        continue;
      }
      try {
        results.push(await this.upsert(item.index, item.ref, plan.contact, caller));
      } catch (err) {
        results.push(this.asFailure(item.index, item.ref, err));
      }
    }
    const summary = summarize(results);
    await this.runs.record(caller.owner.settingsId, 'contacts', body.rows.length, summary);
    return { ok: true, summary, results };
  }

  private async upsert(
    index: number,
    ref: ExtSheetsRowResult['ref'],
    c: PlannedContact,
    caller: SheetsCallerState,
  ): Promise<ExtSheetsRowResult> {
    const ctx = RequestContextStore.require();
    for (let attempt = 1; ; attempt += 1) {
      const found = await this.db.tx(async (tx) => {
        const byEmail = c.email
          ? await this.repo.findByIdentity(tx, ctx.orgId, 'email', c.email)
          : undefined;
        const byPhone = c.phone
          ? await this.repo.findByIdentity(tx, ctx.orgId, 'phone', c.phone)
          : undefined;
        if (byEmail !== undefined && byPhone !== undefined && byEmail !== byPhone) {
          return 'ambiguous' as const;
        }
        const id = byEmail ?? byPhone;
        return id === undefined ? undefined : await this.repo.findById(tx, ctx.orgId, id);
      });

      if (found === 'ambiguous') {
        return failedRow(
          index,
          ref,
          ERROR_CODES.CONFLICT,
          'This email and this phone number belong to two different contacts.',
        );
      }

      if (!found) {
        if (!caller.holds('record.contacts.create')) {
          return failedRow(index, ref, ERROR_CODES.FORBIDDEN, 'Your role cannot create contacts.');
        }
        const made = await this.contacts.createOrMatch(
          {
            email: c.email,
            phone: c.phone,
            name: c.name,
            firstName: c.firstName,
            lastName: c.lastName,
            source: c.source,
            isUnsubscribed: c.isUnsubscribed,
            consent: c.consent,
            customFields: c.customFields,
          },
          sheetsConsentVia(c),
          { createdVia: 'import' },
        );
        // Another request for the same person got there first (the same row sent twice at once): this one found them, nothing was made.
        if (!made.created) {
          return {
            index,
            ...(ref !== undefined ? { ref } : {}),
            status: 'unchanged',
            id: made.contact.id,
          };
        }
        return {
          index,
          ...(ref !== undefined ? { ref } : {}),
          status: 'created',
          id: made.contact.id,
        };
      }

      if (!caller.holds('record.contacts.update')) {
        return failedRow(index, ref, ERROR_CODES.FORBIDDEN, 'Your role cannot edit contacts.');
      }
      // Used only to diff against the sheet row below, never serialized back to the add-on as
      // this contact's own phone display — unmasked so the diff compares real values, not the
      // Contacts-screen masked string against the sheet's raw one.
      const current = toContactResponse(found, { canRevealPhone: true });
      let patch = this.patchOf(current, c);
      // A row that only repeats a consent the ledger already holds changes nothing: it is "unchanged", not another update.
      if (
        patch !== null &&
        Object.keys(patch).length === 1 &&
        patch.consent &&
        (await this.consentAlreadyRecorded(ctx.orgId, current.id, c))
      ) {
        patch = null;
      }
      if (patch === null) {
        return {
          index,
          ...(ref !== undefined ? { ref } : {}),
          status: 'unchanged',
          id: current.id,
        };
      }
      try {
        await this.contacts.update(
          current.id,
          { ...patch, rowVersion: found.rowVersion },
          sheetsConsentVia(c),
        );
        return { index, ...(ref !== undefined ? { ref } : {}), status: 'updated', id: current.id };
      } catch (err) {
        if (
          err instanceof AppError &&
          err.getResponse() &&
          (err.getResponse() as { code?: string }).code === ERROR_CODES.ROW_VERSION_CONFLICT &&
          attempt < UPDATE_ATTEMPTS
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  /** Whether this exact agreement (this person, this note) is already in the consent ledger for the contact. */
  private async consentAlreadyRecorded(
    orgId: number,
    contactUuid: string,
    c: PlannedContact,
  ): Promise<boolean> {
    const via = sheetsConsentVia(c);
    if (!via?.dedupeKey) return false;
    return this.ledgerHasKeyPrefix(orgId, contactUuid, `${via.dedupeKey}:`);
  }

  /**
   * Whether a granted consent of the contact has an idempotency key starting with `prefix`. An exact prefix comparison (`left()`), not
   * `LIKE`: a key holding `%`, `_` or `\\` must match only itself.
   */
  async ledgerHasKeyPrefix(orgId: number, contactUuid: string, prefix: string): Promise<boolean> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT 1 FROM contact_consent_events e
        JOIN contacts k ON k.org_id = e.org_id AND k.id = e.contact_id
        WHERE e.org_id = ${orgId} AND k.uuid = ${contactUuid} AND e.action = 'granted'
          AND left(e.idempotency_key, char_length(${prefix}::text)) = ${prefix}::text
        LIMIT 1`);
      return res.rows.length > 0;
    });
  }

  /**
   * What differs between the stored contact and the row, as an update; null when nothing does. Only what the row gave is considered, so a
   * blank cell never erases, and a value that is already stored is not rewritten (which would stamp a change that is not one).
   */
  private patchOf(
    cur: ContactResponse,
    c: PlannedContact,
  ): Omit<UpdateContactInput, 'rowVersion'> | null {
    const patch: Omit<UpdateContactInput, 'rowVersion'> = {};
    if (c.email && c.email !== cur.email) patch.email = c.email;
    if (c.phone && c.phone !== cur.phone) patch.phone = c.phone;
    if (c.name && c.name !== cur.name) patch.name = c.name;
    if (c.firstName && c.firstName !== cur.firstName) patch.firstName = c.firstName;
    if (c.lastName && c.lastName !== cur.lastName) patch.lastName = c.lastName;
    if (c.isUnsubscribed !== undefined && c.isUnsubscribed !== cur.isUnsubscribed) {
      patch.isUnsubscribed = c.isUnsubscribed;
    }
    // The same yes sent again (the add-on re-sends changed rows) records once: `sheetsConsentVia` gives the grant a stable key.
    if (c.consent) patch.consent = c.consent;
    const attrs = Object.fromEntries(
      Object.entries(c.customFields).filter(
        ([k, v]) => JSON.stringify(cur.customFields[k]) !== JSON.stringify(v),
      ),
    );
    if (Object.keys(attrs).length > 0) patch.customFields = attrs;
    return Object.keys(patch).length === 0 ? null : patch;
  }

  /** A row's failure as a result. An error that is not ours is logged and answered generically: its text may name internals. */
  private asFailure(
    index: number,
    ref: ExtSheetsRowResult['ref'],
    err: unknown,
  ): ExtSheetsRowResult {
    if (err instanceof AppError) {
      const body = err.getResponse() as { code: string; message: string };
      const first = err.details?.[0];
      return failedRow(
        index,
        ref,
        body.code,
        first?.message ?? body.message,
        first?.path || undefined,
      );
    }
    this.logger.error({ err }, 'sheets add-on: a contact row failed unexpectedly');
    return failedRow(
      index,
      ref,
      ERROR_CODES.INTERNAL,
      'This row could not be saved. Try it again.',
    );
  }
}
